"""Fleet ROS/physics regressions; runnable in the Docker image."""
import json
import math
import sys
import time
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
try:
    import rclpy
except ImportError:
    rclpy=None


@unittest.skipIf(rclpy is None,"ROS 2 rclpy is not installed")
class FleetRuntimeTests(unittest.TestCase):
    def setUp(self):
        from agv_web_bridge.fleet_simulation import create_robots
        rclpy.init(); self.nodes=create_robots()

    def tearDown(self):
        for node in self.nodes:
            node.destroy_node()
        rclpy.shutdown()

    def test_exported_frontend_grid_matches_backend(self):
        import subprocess
        subprocess.run([sys.executable,str(Path(__file__).resolve().parents[4]/'scripts/export_fleet_grid.py'),'--check'],check=True)

    def test_fleet_command_watchdog_uses_steady_time_and_discards_expired_motion(self):
        from geometry_msgs.msg import Twist
        from unittest.mock import patch
        robot = self.nodes[0]
        forward = Twist()
        forward.linear.x = 1.
        with patch.object(robot, "_now_seconds", return_value=10.), \
                patch("time.monotonic", return_value=100.):
            robot._handle_cmd_vel(forward)
            robot._step()
        self.assertGreater(robot.v, 0.)
        with patch.object(robot, "_now_seconds", return_value=9.), \
                patch("time.monotonic", return_value=100.5):
            robot._step()
            self.assertTrue(robot.cmd_timed_out)
            self.assertEqual(robot.target_v, 0.)
            self.assertAlmostEqual(robot.v, 0.)

    def test_invalid_cruise_exits_with_fatal_diagnostic_without_traceback(self):
        import subprocess
        for value in ("2.0", "0.0", "0", ".nan", "nan"):
            with self.subTest(value=value):
                result = subprocess.run(
                    [sys.executable, "-c", "from agv_web_bridge.fleet_node import main; main()",
                     "--ros-args", "-p", f"autonomous_cruise_speed:={value}"],
                    capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("[FATAL]", result.stderr)
                self.assertIn("autonomous_cruise_speed must be finite and in (0, 1.2] m/s", result.stderr)
                self.assertNotIn("Traceback", result.stderr)

    def test_expired_queued_velocity_cannot_restart_simulation(self):
        from agv_web_bridge.fleet_node import FleetNode
        from agv_web_bridge.motion_limits import FLEET_COMMAND_LIFESPAN
        from rclpy.executors import SingleThreadedExecutor
        robot = self.nodes[0]
        fleet = FleetNode()
        executor = SingleThreadedExecutor()
        executor.add_node(robot)
        try:
            output = fleet.robots["agv1"]["output"]
            deadline = time.monotonic() + 2.
            while not output.get_subscription_count() and time.monotonic() < deadline:
                executor.spin_once(timeout_sec=.01)
            self.assertGreater(output.get_subscription_count(), 0)
            fleet.publish_velocity("agv1", (1., 0.))
            time.sleep(FLEET_COMMAND_LIFESPAN + .1)
            for _ in range(10):
                executor.spin_once(timeout_sec=.02)
            self.assertIsNone(robot.last_cmd_time)
            self.assertEqual(robot.v, 0.)

            fleet.publish_velocity("agv1", (1., 0.))
            deadline = time.monotonic() + .15
            while robot.last_cmd_time is None and time.monotonic() < deadline:
                executor.spin_once(timeout_sec=.01)
            self.assertIsNotNone(robot.last_cmd_time)
        finally:
            executor.shutdown()
            fleet.destroy_node()

    def test_peer_collision_blocks_and_both_scans_detect_robot(self):
        from agv_web_bridge.lidar import scan_ranges
        from geometry_msgs.msg import Twist
        a,b=self.nodes
        self.assertEqual(a.odom_publisher.topic_name,"/agv1/odom")
        self.assertEqual(b.odom_publisher.topic_name,"/agv2/odom")
        a.x,a.y,a.yaw=10.,0.,0.; b.x,b.y,b.yaw=13.,0.,0.
        for height in (1.02,.02):
            ranges=scan_ranges(a.dynamic_obstacles(),a.x,a.y,a.yaw,height=height)
            self.assertTrue(any(math.isfinite(v) and 2<v<3 for v in ranges))
        command=Twist(); command.linear.x=.7
        for _ in range(300):
            a._handle_cmd_vel(command); a._step()
        self.assertTrue(a.blocked_now)
        self.assertEqual(a.last_object_id,"agv2")
        self.assertIsNone(a._current_collision())

    def test_slow_search_does_not_block_control_or_restore_canceled_goal(self):
        from threading import Event
        from agv_web_bridge.fleet_node import FleetNode
        from std_msgs.msg import String

        fleet = FleetNode()
        searching, finish = Event(), Event()
        original_route = fleet.planner.route

        def slow_route(*args, **kwargs):
            searching.set()
            finish.wait(.35)
            return original_route(*args, **kwargs)

        fleet.planner.route = slow_route
        try:
            for rid, x in (("agv1", -8.), ("agv2", 8.)):
                robot = fleet.robots[rid]
                robot.update(pose=(x, 1.6, 0.), truth_time=fleet.now())
                control = robot["control"]
                control.odom_time = control.scan_time = control.heartbeat_time = fleet.now()
            fleet.command("agv1", String(data=json.dumps(
                dict(action="goal", x=-5., y=1.6, yaw=0., request_id="slow"))))
            before = time.perf_counter()
            fleet.tick()
            self.assertLess(time.perf_counter() - before, .100)
            self.assertTrue(searching.wait(1.))
            self.assertTrue(fleet.robots["agv1"]["goal"])

            fleet.command("agv1", String(data='{"action":"cancel"}'))
            job = fleet.plan_jobs["agv1"][-1]
            finish.set()
            job.result(timeout=1.)
            state = fleet.tick()["robots"]["agv1"]
            self.assertEqual((state["state"], state["request_id"]), ("canceled", "slow"))
            self.assertFalse(state["busy"])
            self.assertFalse(fleet.robots["agv1"]["path"])
            self.assertNotIn("agv1", fleet.reservations.routes)
        finally:
            finish.set()
            fleet.destroy_node()

    def test_transport_parallel_goals_and_watchdogs(self):
        from agv_web_bridge.fleet_node import FleetNode
        from rclpy.executors import SingleThreadedExecutor
        from std_msgs.msg import String
        from nav_msgs.msg import Odometry
        from geometry_msgs.msg import Twist
        from sensor_msgs.msg import LaserScan
        from tf2_msgs.msg import TFMessage
        fleet=FleetNode(); harness=rclpy.create_node("fleet_test")
        executor=SingleThreadedExecutor()
        for node in self.nodes+[fleet,harness]: executor.add_node(node)
        heartbeats={rid:harness.create_publisher(String,f"/{rid}/agv_web/operator_heartbeat",10) for rid in fleet.robots}
        pair_command=harness.create_publisher(String,"/fleet/start_pair",10)
        scans={rid:[] for rid in fleet.robots}; odoms={rid:[] for rid in fleet.robots}; tf=[]; states=[]
        for rid in fleet.robots:
            harness.create_subscription(LaserScan,f"/{rid}/scan",scans[rid].append,10)
            harness.create_subscription(Odometry,f"/{rid}/odom",odoms[rid].append,10)
        harness.create_subscription(TFMessage,"/tf",tf.append,10)
        harness.create_subscription(String,"/fleet/state",lambda msg:states.append(json.loads(msg.data)),10)
        def spin(duration,heartbeat=True):
            end=time.monotonic()+duration
            while time.monotonic()<end:
                if heartbeat:
                    for pub in heartbeats.values(): pub.publish(String(data="alive"))
                executor.spin_once(timeout_sec=.01)
        try:
            spin(2)
            for rid in fleet.robots:
                self.assertTrue(scans[rid]); self.assertTrue(odoms[rid])
                self.assertEqual(scans[rid][-1].header.frame_id,f"{rid}/laser_frame")
                self.assertEqual(odoms[rid][-1].child_frame_id,f"{rid}/base_link")
            children={t.child_frame_id for msg in tf for t in msg.transforms}
            self.assertTrue({"agv1/base_link","agv2/base_link"}<=children)
            pair_command.publish(String(data=json.dumps(dict(request_id="test-pair", goals={
                "agv1": dict(action="goal",x=-.8,y=1.6,yaw=0),
                "agv2": dict(action="goal",x=6.5,y=1.6,yaw=0),
            }))))
            spin(16)
            self.assertTrue(any(all(v["state"]=="navigating" and v["request_id"]=="test-pair"
                                    for v in s["robots"].values()) for s in states))
            for node in self.nodes:
                self.assertGreater(node.x, -1.1 if node.get_namespace()=="/agv1" else 6.2)
            self.assertTrue(all(r["state"]=="succeeded" for r in fleet.robots.values()))
            # Conflicting aisle request waits; bounded timeout terminates it.
            r=fleet.robots["agv1"]; other=fleet.robots["agv2"]
            fleet.reservations.acquire("agv2",{(x,y) for x in range(-10,20) for y in range(-10,20)})
            fleet.command("agv1",String(data=json.dumps(dict(action="goal",x=1.,y=1.6,yaw=0))))
            fleet.tick(); self.assertEqual(r["state"],"waiting")
            r["wait_since"]-=31; fleet.tick(); self.assertEqual(r["state"],"failed")
            fleet.reservations.release("agv2")
            fleet.command("agv2",String(data=json.dumps(dict(action="goal",x=9.,y=1.6,yaw=0))))
            spin(1); spin(3,False)
            self.assertEqual(other["state"],"safety_stop")
            # The shared test executor can skip physics callbacks while planning.
            # Give a stopped target time to decelerate in actual physics steps.
            deadline = time.monotonic() + 1.5
            while abs(self.nodes[1].v) > 1e-7 and time.monotonic() < deadline:
                spin(.05, False)
            self.assertAlmostEqual(self.nodes[1].v,0.)
            # Separation stops approaching commands; manual retreat recovers.
            spin(.2); self.nodes[1].x=self.nodes[0].x+2.
            spin(.3)
            self.assertTrue(states[-1]["safety_stop"])
            manual=harness.create_publisher(Twist,"/agv1/agv_web/manual_cmd_vel",10)
            spin(.2)
            approach=Twist(); approach.linear.x=.4
            manual.publish(approach); spin(.15)
            self.assertAlmostEqual(self.nodes[0].v,0.)
            # Keep heartbeat/sensors fresh while repeatedly commanding retreat.
            retreat=Twist(); retreat.linear.x=-.2
            initial=self.nodes[0].x
            for _ in range(100):
                manual.publish(retreat); spin(.15)
                if states[-1]["separation_m"]>3.4:
                    break
            self.assertLess(self.nodes[0].x,initial-.8)
            self.assertFalse(states[-1]["safety_stop"],states[-1])
            self.assertGreater(states[-1]["separation_m"],3.3)
        finally:
            executor.shutdown(); harness.destroy_node(); fleet.destroy_node()

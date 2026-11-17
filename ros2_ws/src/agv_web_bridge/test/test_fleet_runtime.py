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

    def test_transport_parallel_goals_and_watchdogs(self):
        from agv_web_bridge.fleet_node import FleetNode
        from rclpy.executors import SingleThreadedExecutor
        from std_msgs.msg import String
        from nav_msgs.msg import Odometry
        from sensor_msgs.msg import LaserScan
        from tf2_msgs.msg import TFMessage
        fleet=FleetNode(); harness=rclpy.create_node("fleet_test")
        executor=SingleThreadedExecutor()
        for node in self.nodes+[fleet,harness]: executor.add_node(node)
        heartbeats={rid:harness.create_publisher(String,f"/{rid}/agv_web/operator_heartbeat",10) for rid in fleet.robots}
        commands={rid:harness.create_publisher(String,f"/{rid}/agv_web/navigation_command",10) for rid in fleet.robots}
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
            commands["agv1"].publish(String(data=json.dumps(dict(action="goal",x=-.8,y=1.6,yaw=0))))
            commands["agv2"].publish(String(data=json.dumps(dict(action="goal",x=6.5,y=1.6,yaw=0))))
            spin(9)
            self.assertTrue(any(all(v["state"]=="navigating" for v in s["robots"].values()) for s in states))
            for node in self.nodes:
                self.assertGreater(node.x, -1.1 if node.get_namespace()=="/agv1" else 6.2)
            self.assertTrue(all(r["state"]=="succeeded" for r in fleet.robots.values()))
            # Conflicting aisle request waits; bounded timeout terminates it.
            r=fleet.robots["agv1"]; other=fleet.robots["agv2"]
            fleet.reservations.acquire("agv2",{(x,y) for x in range(-10,20) for y in range(-10,20)})
            fleet.command("agv1",String(data=json.dumps(dict(action="goal",x=1.,y=1.6,yaw=0))))
            fleet.tick(); self.assertEqual(r["state"],"waiting")
            r["requested"]-=31; fleet.tick(); self.assertEqual(r["state"],"failed")
            fleet.reservations.release("agv2")
            fleet.command("agv2",String(data=json.dumps(dict(action="goal",x=9.,y=1.6,yaw=0))))
            spin(1); spin(3,False)
            self.assertEqual(other["state"],"safety_stop")
            self.assertAlmostEqual(self.nodes[1].v,0.)
            # Separation stops both commands, including manual driving.
            spin(.2); self.nodes[1].x=self.nodes[0].x+2.
            spin(.3)
            self.assertTrue(states[-1]["safety_stop"])
        finally:
            executor.shutdown(); harness.destroy_node(); fleet.destroy_node()

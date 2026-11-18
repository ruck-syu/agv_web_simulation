"""ROS binding checks: drive fixed simulation steps and inspect real ROS messages.

The harness executor intentionally runs only subscribers; simulation steps are
advanced explicitly, so the tests do not depend on timer scheduling speed.
"""
import json
import math
import sys
import time
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import rclpy
except ModuleNotFoundError:
    rclpy = None


@unittest.skipIf(rclpy is None, 'ROS 2 rclpy is not installed')
class OdometryRuntimeTests(unittest.TestCase):
    def scenario(self, left=1.0, right=1.0, wall=False):
        from agv_web_bridge.simulation_node import SimulationNode
        from geometry_msgs.msg import Twist
        from nav_msgs.msg import Odometry
        from std_msgs.msg import String
        from tf2_msgs.msg import TFMessage
        from rclpy.executors import SingleThreadedExecutor
        args = ['--ros-args', '-p', f'odom_left_scale:={left}', '-p', f'odom_right_scale:={right}']
        if wall:
            args += ['-p', 'initial_x:=30.5', '-p', 'initial_y:=4.0']
        rclpy.init(args=args)
        simulation = harness = executor = None
        try:
            simulation = SimulationNode()
            harness = rclpy.create_node('odometry_acceptance_test')
            executor = SingleThreadedExecutor()
            executor.add_node(harness)
            odoms, truths, transforms, statuses = [], [], [], []
            harness.create_subscription(Odometry, '/odom', odoms.append, 10)
            harness.create_subscription(Odometry, '/agv_web/ground_truth', truths.append, 10)
            harness.create_subscription(TFMessage, '/tf', transforms.append, 10)
            harness.create_subscription(String, '/agv_web/odometry_status', statuses.append, 10)

            def receive(duration=0.2):
                deadline = time.monotonic() + duration
                while time.monotonic() < deadline:
                    executor.spin_once(timeout_sec=0.01)

            receive(0.5)
            command = Twist()
            command.linear.x = 0.3
            command.angular.z = 0.0 if wall else 0.2
            for index in range(300):
                simulation._handle_cmd_vel(command)
                simulation._step()
                if index % 10 == 0:
                    receive(0.01)
            if wall:
                self.assertTrue(simulation.blocked_now)
                frozen = (simulation.x, simulation.y, simulation.left_wheel_angle,
                          simulation.right_wheel_angle, simulation.wheel_odometry.x,
                          simulation.wheel_odometry.y)
                for _ in range(50):
                    simulation._handle_cmd_vel(command)
                    simulation._step()
                self.assertEqual(frozen, (simulation.x, simulation.y, simulation.left_wheel_angle,
                    simulation.right_wheel_angle, simulation.wheel_odometry.x, simulation.wheel_odometry.y))
            # Exercise timeout path and deceleration, rather than injecting a stop command.
            simulation.last_cmd_time = time.monotonic() - 1.0
            for _ in range(100):
                simulation._step()
            odoms.clear(); truths.clear(); transforms.clear(); statuses.clear()
            receive()
            simulation._publish_state(simulation._now_seconds())
            receive(0.5)
            self.assertTrue(odoms and truths and transforms and statuses)
            odom = odoms[-1]
            stamp = odom.header.stamp
            truth = next(t for t in truths if t.header.stamp == stamp)
            transform = next(t for m in transforms for t in m.transforms
                if t.header.frame_id == 'odom' and t.child_frame_id == 'base_link' and t.header.stamp == stamp)
            self.assertEqual(odom.header.frame_id, 'odom')
            self.assertEqual(odom.child_frame_id, 'base_link')
            self.assertEqual(truth.header.frame_id, 'world')
            self.assertEqual(truth.child_frame_id, 'ground_truth_base_link')
            self.assertEqual(transform.transform.translation.x, odom.pose.pose.position.x)
            self.assertEqual(transform.transform.translation.y, odom.pose.pose.position.y)
            self.assertEqual(transform.transform.rotation, odom.pose.pose.orientation)
            self.assertAlmostEqual(odom.twist.twist.linear.x, 0)
            self.assertAlmostEqual(odom.twist.twist.angular.z, 0)
            self.assertEqual(truth.pose.pose.position.x, simulation.x)
            self.assertGreater(odom.pose.covariance[35], 0.004)
            self.assertEqual(odom.pose.covariance[14], 1e6)
            status = json.loads(statuses[-1].data)
            if left == right == 1.0:
                self.assertLess(status['position_error_m'], 1e-9)
                self.assertLess(abs(status['heading_error_rad']), 1e-9)
            else:
                self.assertGreater(status['position_error_m'], 0.001)
                self.assertGreater(abs(status['heading_error_rad']), 0.001)
            self.assertAlmostEqual(status['position_error_m'], math.hypot(
                odom.pose.pose.position.x - truth.pose.pose.position.x,
                odom.pose.pose.position.y - truth.pose.pose.position.y))
        finally:
            if executor:
                executor.shutdown()
            if harness:
                harness.destroy_node()
            if simulation:
                simulation.destroy_node()
            rclpy.shutdown()

    def test_ideal_encoder_matches_ground_truth_and_tf(self):
        self.scenario()

    def test_calibration_drift_is_published(self):
        self.scenario(left=0.98, right=1.02)

    def test_blocked_robot_does_not_accumulate_odometry(self):
        self.scenario(left=0.98, right=1.02, wall=True)


if __name__ == '__main__':
    unittest.main()

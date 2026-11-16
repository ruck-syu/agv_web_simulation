"""Live ROS acceptance gate. Run after sourcing Humble; skips without rclpy."""
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
class LidarRuntimeTests(unittest.TestCase):
    def test_scan_tf_and_motion(self):
        from agv_web_bridge.simulation_node import SimulationNode
        from geometry_msgs.msg import Twist
        from nav_msgs.msg import Odometry
        from sensor_msgs.msg import LaserScan
        from tf2_msgs.msg import TFMessage
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.qos import QoSProfile, DurabilityPolicy

        rclpy.init()
        simulation = harness = executor = None
        try:
            simulation = SimulationNode()
            harness = rclpy.create_node('lidar_acceptance_test')
            scans, odoms, transforms = [], [], []
            harness.create_subscription(LaserScan, '/scan', scans.append, 10)
            harness.create_subscription(Odometry, '/odom', odoms.append, 10)
            harness.create_subscription(TFMessage, '/tf_static', transforms.append,
                QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL))
            command = harness.create_publisher(Twist, '/cmd_vel', 10)
            executor = SingleThreadedExecutor()
            executor.add_node(simulation)
            executor.add_node(harness)

            def spin(duration, drive=None):
                deadline = time.monotonic() + duration
                while time.monotonic() < deadline:
                    if drive is not None:
                        command.publish(drive)
                    executor.spin_once(timeout_sec=0.02)

            spin(2.0)
            self.assertGreaterEqual(len(scans), 10)
            self.assertTrue(odoms)
            scan = scans[-1]
            self.assertEqual(scan.header.frame_id, 'laser_frame')
            self.assertEqual(len(scan.ranges), 360)
            self.assertAlmostEqual(scan.angle_max,
                scan.angle_min + 359 * scan.angle_increment, places=5)
            self.assertEqual(scan.time_increment, 0.0)
            self.assertAlmostEqual(scan.scan_time, 0.1, places=5)
            self.assertTrue(any(math.isfinite(r) for r in scan.ranges))
            self.assertTrue(all(not math.isfinite(r) or scan.range_min <= r <= scan.range_max
                                for r in scan.ranges))
            stamps = [s.header.stamp.sec + s.header.stamp.nanosec * 1e-9 for s in scans]
            self.assertGreater(stamps[-1], stamps[0])
            self.assertTrue(any(t.header.frame_id == 'base_link' and
                t.child_frame_id == 'laser_frame' and
                abs(t.transform.translation.z - 1.02) < 1e-6
                for message in transforms for t in message.transforms))
            before = odoms[-1].pose.pose.position.x
            scan_count = len(scans)
            drive = Twist()
            drive.linear.x = 0.2
            spin(1.0, drive)
            self.assertGreater(odoms[-1].pose.pose.position.x - before, 0.05)
            self.assertGreater(len(scans), scan_count + 5)
            # Command timeout must still stop motion with the sensor timer active.
            spin(1.2)
            self.assertAlmostEqual(odoms[-1].twist.twist.linear.x, 0.0, places=5)
        finally:
            if executor:
                executor.shutdown()
            if harness:
                harness.destroy_node()
            if simulation:
                simulation.destroy_node()
            rclpy.shutdown()


if __name__ == '__main__':
    unittest.main()

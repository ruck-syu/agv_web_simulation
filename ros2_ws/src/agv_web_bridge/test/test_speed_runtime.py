"""Verify higher speeds reach the wheels and retain collision/timeout stopping."""
import math
import sys
import time
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import rclpy
except ImportError:
    rclpy = None


@unittest.skipIf(rclpy is None, 'ROS 2 rclpy is not installed')
class SpeedRuntimeTests(unittest.TestCase):
    def run_motion(self, x, y, angular=0.0, wall=False):
        from agv_web_bridge.simulation_node import SimulationNode
        from agv_web_bridge.control import CommandArbiter
        from geometry_msgs.msg import Twist
        rclpy.init(args=['--ros-args', '-p', f'initial_x:={x}', '-p', f'initial_y:={y}'])
        node = None
        try:
            node = SimulationNode()
            control = CommandArbiter()
            for _ in range(100):
                now = node._now_seconds()
                control.receive_manual(1.2, angular, now)
                linear, turn = control.command(now)
                command = Twist(); command.linear.x = linear; command.angular.z = turn
                node._handle_cmd_vel(command)
                node._step()
            if wall:
                self.assertTrue(node.blocked_now)
                self.assertIsNone(node._current_collision())
                self.assertLessEqual(node.x + node.half_length, 31.7)
                self.assertEqual(node.v, 0.0)
            else:
                self.assertAlmostEqual(node.v, 1.2)
                self.assertAlmostEqual(node.w, angular)
                self.assertGreater(math.hypot(node.x - x, node.y - y), 1.5)
                self.assertLessEqual(abs(node.left_wheel_velocity), node.max_wheel_angular_velocity)
                self.assertLessEqual(abs(node.right_wheel_velocity), node.max_wheel_angular_velocity)
                node.last_cmd_time = time.monotonic() - 1.0
                for _ in range(100): node._step()
                self.assertTrue(node.cmd_timed_out)
                self.assertEqual((node.v, node.w), (0.0, 0.0))
        finally:
            if node: node.destroy_node()
            rclpy.shutdown()

    def test_manual_speed_reaches_1_2_mps(self):
        self.run_motion(10.0, 0.0)

    def test_turning_does_not_clip_requested_linear_speed(self):
        self.run_motion(10.0, 0.0, angular=1.2)

    def test_full_speed_wall_collision_is_blocked(self):
        self.run_motion(30.5, 4.0, wall=True)

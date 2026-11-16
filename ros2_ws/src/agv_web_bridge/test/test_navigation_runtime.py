"""Exercise real Node initialization and action races without a Nav2 server."""
import sys
import unittest
from concurrent.futures import Future
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import rclpy
except ImportError:
    rclpy = None


@unittest.skipIf(rclpy is None, 'ROS 2 rclpy is not installed')
class NavigationLifecycleTests(unittest.TestCase):
    def setUp(self):
        from agv_web_bridge.navigation_node import NavigationNode
        rclpy.init(args=[])
        self.node = NavigationNode()

    def tearDown(self):
        self.node.destroy_node()
        rclpy.shutdown()

    def test_node_initializes_and_requires_active_lifecycle(self):
        self.assertIsNone(self.node.goal_handle)
        self.assertFalse(self.node._stack_ready())
        self.node._tick()
        self.node._status()

    def test_autonomy_requires_fresh_map_and_localization(self):
        import time
        now = time.monotonic()
        self.assertFalse(self.node._localization_ready(now))
        self.node.map_time = self.node.map_tf_time = now
        self.assertTrue(self.node._localization_ready(now + 0.1))
        self.assertFalse(self.node._localization_ready(now + 2))
        self.node.control.start()
        self.node.control.scan_time = self.node.control.odom_time = self.node.control.heartbeat_time = now
        self.node._stack_ready = lambda: True
        self.node.map_tf_time = now - 10
        self.node._tick()
        self.assertEqual(self.node.state, 'canceled')
        self.assertEqual(self.node.control.mode, 'manual')

    def test_late_acceptance_is_canceled_and_keeps_new_goals_blocked(self):
        from std_msgs.msg import String
        result = Future()
        cancellations = []
        handle = SimpleNamespace(accepted=True, cancel_goal_async=lambda: cancellations.append(True), get_result_async=lambda: result)
        self.node.pending = True
        self.node.revision = 1
        self.node._cancel('Cancel while request is pending')
        accepted = Future(); accepted.set_result(handle)
        self.node._accepted(accepted, 1)
        self.assertEqual(cancellations, [True])
        self.assertIs(self.node.goal_handle, handle)
        message = String(); message.data = '{"action":"goal","x":1,"y":1,"yaw":0}'
        self.node._command(message)
        self.assertIn('active', self.node.detail)
        self.assertIs(self.node.goal_handle, handle)
        result.set_result(SimpleNamespace(status=5))
        self.assertIsNone(self.node.goal_handle)
        self.assertEqual(self.node.control.mode, 'manual')

    def test_failed_pending_request_does_not_leave_busy_latched(self):
        self.node.pending = True; self.node.revision = 1
        self.node._cancel('stop')
        future = Future(); future.set_exception(RuntimeError('Server disconnected'))
        self.node._accepted(future, 1)
        self.assertFalse(self.node.pending)
        self.assertIsNone(self.node.goal_handle)

    def test_stale_result_cannot_reenable_autonomous_commands(self):
        self.node.revision = 1
        self.node.control.start()
        self.node._cancel('stop')
        future = Future(); future.set_result(SimpleNamespace(status=4))
        self.node._result(future, 1)
        self.assertEqual(self.node.state, 'canceled')
        self.assertEqual(self.node.control.command(100), (0, 0))

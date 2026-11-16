import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agv_web_bridge.control import CommandArbiter, valid_goal
from agv_web_bridge.configuration import merge, wall_clock


class ControlTests(unittest.TestCase):
    def test_idle_and_expired_commands_stop(self):
        control = CommandArbiter()
        self.assertEqual(control.command(10), (0, 0))
        control.receive_manual(0.3, 0.2, 10)
        self.assertEqual(control.command(10.1), (0.3, 0.2))
        self.assertEqual(control.command(10.4), (0, 0))

    def test_manual_preempts_navigation(self):
        control = CommandArbiter()
        control.start()
        control.receive_navigation(0.3, 0, 10)
        control.receive_manual(-0.2, 0, 10)
        control.receive_navigation(0.5, 1, 10.1)
        self.assertEqual(control.command(10.1), (-0.2, 0))
        self.assertEqual(control.mode, 'manual')

    def test_navigation_requires_fresh_sensors_heartbeat_and_velocity(self):
        control = CommandArbiter()
        control.start()
        control.receive_navigation(0.3, 0.2, 10)
        self.assertEqual(control.command(10.1), (0, 0))
        control.heartbeat_time = control.odom_time = control.scan_time = 10
        self.assertEqual(control.command(10.1), (0.3, 0.2))
        self.assertEqual(control.command(10.4), (0, 0))
        control.receive_navigation(0.3, 0.2, 12)
        self.assertEqual(control.command(12.1), (0, 0))

    def test_stop_does_not_replay_old_commands(self):
        control = CommandArbiter()
        control.receive_manual(0.5, 0, 10)
        control.stop()
        self.assertEqual(control.command(10.1), (0, 0))
        control.start()
        control.heartbeat_time = control.odom_time = control.scan_time = 10
        self.assertEqual(control.command(10.1), (0, 0))

    def test_nonfinite_input_and_speed_limits(self):
        control = CommandArbiter()
        self.assertFalse(control.receive_manual(math.nan, 1, 10))
        self.assertEqual(control.command(10), (0, 0))
        control.receive_manual(10, -10, 10)
        self.assertEqual(control.command(10.1), (1.2, -1.2))

    def test_goal_validation(self):
        self.assertEqual(valid_goal({'action': 'goal', 'x': 1, 'y': 2, 'yaw': 0}), (1, 2, 0))
        for payload in (None, [], {}, {'action': 'cancel'}, {'action': 'goal', 'x': True, 'y': 1, 'yaw': 0},
                        {'action': 'goal', 'x': 101, 'y': 1, 'yaw': 0},
                        {'action': 'goal', 'x': math.inf, 'y': 1, 'yaw': 0}):
            self.assertIsNone(valid_goal(payload))

    def test_config_merge_preserves_defaults_and_nested_costmaps(self):
        original = {'node': {'ros__parameters': {'use_sim_time': True, 'keep': 1}},
                    'costmap': {'local': {'ros__parameters': {'use_sim_time': True}}}}
        result = wall_clock(merge(original, {'node': {'ros__parameters': {'new': 2}}}))
        self.assertEqual(result['node']['ros__parameters'], {'use_sim_time': False, 'keep': 1, 'new': 2})
        self.assertFalse(result['costmap']['local']['ros__parameters']['use_sim_time'])
        self.assertTrue(original['node']['ros__parameters']['use_sim_time'])

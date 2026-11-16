"""Rack footprints are reserved floor space, including gaps below shelves."""
import json
import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import rclpy
except ImportError:
    rclpy = None


@unittest.skipIf(rclpy is None, 'ROS 2 rclpy is not installed')
class RackNavigationTests(unittest.TestCase):
    def test_every_bay_blocks_the_full_robot_below_the_first_shelf(self):
        from agv_web_bridge.simulation_node import SimulationNode, find_collision
        config = SimulationNode._load_config(SimulationNode._default_config_path())
        obstacles = SimulationNode._build_obstacles(config)
        structure = config['rack_structure']; template = structure['template']
        for row in structure['rows']:
            for bay in range(template['bays']):
                x = row['cx'] - template['length']/2 + (bay+.5)*template['bay_width']
                with self.subTest(rack=row['id'], bay=bay):
                    hit = find_collision(obstacles,x,row['cy'],0,.775,.53,.96)
                    self.assertIsNotNone(hit, 'An empty bay must not be traversable under its shelf')

    def test_both_scan_planes_see_the_reserved_rack_boundary(self):
        from agv_web_bridge.simulation_node import SimulationNode
        from agv_web_bridge.lidar import scan_ranges
        config = SimulationNode._load_config(SimulationNode._default_config_path())
        obstacles = SimulationNode._build_obstacles(config)
        for height in (.02,1.02):
            # Middle of a bay, not aimed at an upright or footplate.
            ranges=scan_ranges(obstacles,-13.5,2.28,math.pi/2,height=height)
            self.assertLess(ranges[180],2.0)
            self.assertGreater(ranges[180],1.5)

    def test_open_aisles_and_cross_aisle_remain_clear(self):
        from agv_web_bridge.simulation_node import SimulationNode, find_collision
        config=SimulationNode._load_config(SimulationNode._default_config_path())
        obstacles=SimulationNode._build_obstacles(config)
        for x,y in [(-12,9.2),(-12,1.6),(-12,-6),(4.4,9.2),(4.4,1.6),(4.4,-6)]:
            self.assertIsNone(find_collision(obstacles,x,y,0,.775,.53,.96),(x,y))

    def test_manual_driving_cannot_enter_a_rack_bay(self):
        from agv_web_bridge.simulation_node import SimulationNode
        from geometry_msgs.msg import Twist
        rclpy.init(args=['--ros-args','-p','initial_x:=-13.5','-p','initial_y:=2.28','-p',f'initial_yaw:={math.pi/2}'])
        node=None
        try:
            node=SimulationNode()
            command=Twist();command.linear.x=1.2
            for _ in range(160):
                node._handle_cmd_vel(command);node._step()
            self.assertTrue(node.blocked_now)
            self.assertIsNone(node._current_collision())
            self.assertLess(node.y,3.24)
        finally:
            if node:node.destroy_node()
            rclpy.shutdown()

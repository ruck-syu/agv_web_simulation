"""Deterministic LiDAR geometry tests; no ROS installation required."""
import math
import sys
import unittest
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agv_web_bridge.lidar import ray_distance, scan_ranges


@dataclass
class Obstacle:
    cx: float = 5.0
    cy: float = 0.0
    hx: float = 1.0
    hy: float = 1.0
    yaw: float = 0.0
    shape: str = 'box'
    min_z: float = 0.0
    max_z: float = 2.0


class LidarTests(unittest.TestCase):
    def test_box_parallel_and_miss(self):
        box = Obstacle()
        self.assertAlmostEqual(ray_distance(box, 0, 0, 0), 4)
        self.assertTrue(math.isinf(ray_distance(box, 0, 2, 0)))
        self.assertTrue(math.isinf(ray_distance(box, 0, 0, math.pi)))

    def test_rotated_box(self):
        box = Obstacle(hx=2, hy=0.5, yaw=math.pi / 2)
        self.assertAlmostEqual(ray_distance(box, 0, 0, 0), 4.5)

    def test_circle_tangent_miss_and_inside(self):
        circle = Obstacle(shape='circle')
        self.assertAlmostEqual(ray_distance(circle, 0, 0, 0), 4)
        self.assertAlmostEqual(ray_distance(circle, 0, 1, 0), 5)
        self.assertTrue(math.isinf(ray_distance(circle, 0, 1.01, 0)))
        self.assertEqual(ray_distance(circle, 5, 0, 0), 0)

    def test_box_inside(self):
        self.assertEqual(ray_distance(Obstacle(), 5, 0, 0), 0)

    def test_occlusion_and_height(self):
        ranges = scan_ranges([Obstacle(), Obstacle(cx=3, max_z=0.5),
                              Obstacle(cx=2, min_z=1.25)], 0, 0, 0)
        self.assertEqual(len(ranges), 360)
        self.assertAlmostEqual(ranges[180], 4)
        self.assertAlmostEqual(scan_ranges([Obstacle(cx=3), Obstacle()], 0, 0, 0)[180], 2)

    def test_range_limits(self):
        self.assertEqual(scan_ranges([], 0, 0, 0)[0], math.inf)
        self.assertEqual(scan_ranges([Obstacle(cx=50)], 0, 0, 0)[180], math.inf)
        self.assertEqual(scan_ranges([Obstacle(cx=1.01)], 0, 0, 0)[180], -math.inf)
        self.assertEqual(scan_ranges([Obstacle(cx=31)], 0, 0, 0)[180], 30)

    def test_robot_rotation_and_translation(self):
        self.assertAlmostEqual(scan_ranges([Obstacle()], 1, 0, math.pi / 2)[90], 3)
        self.assertEqual(scan_ranges([Obstacle()], 1, 0, math.pi / 2)[180], math.inf)

    def test_batch_matches_scalar_intersections(self):
        import random
        from agv_web_bridge import lidar
        if lidar.np is None:
            self.skipTest('NumPy accelerator is available in the ROS runtime')
        randomizer = random.Random(7)
        obstacles = [Obstacle(cx=randomizer.uniform(-8, 8), cy=randomizer.uniform(-8, 8),
            hx=randomizer.uniform(0.1, 2), hy=randomizer.uniform(0.1, 2), yaw=randomizer.uniform(-3, 3),
            shape='circle' if index % 3 == 0 else 'box') for index in range(20)]
        for yaw in (0, 0.7, -2.4):
            actual = scan_ranges(obstacles, 0, 0, yaw)
            for index, value in enumerate(actual):
                angle = yaw - math.pi + index * math.tau / 360
                distance = min(ray_distance(o, 0, 0, angle) for o in obstacles)
                expected = -math.inf if distance < 0.05 else distance if distance <= 30 else math.inf
                if math.isfinite(expected):
                    self.assertAlmostEqual(value, expected, places=8)
                else:
                    self.assertEqual(value, expected)

    def test_invalid_configuration(self):
        with self.assertRaises(ValueError):
            scan_ranges([], 0, 0, 0, samples=0)
        with self.assertRaises(ValueError):
            scan_ranges([], 0, 0, 0, range_min=5, range_max=1)


if __name__ == '__main__':
    unittest.main()

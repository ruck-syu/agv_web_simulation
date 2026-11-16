"""Analytic acceptance checks for encoder integration and uncertainty."""
import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agv_web_bridge.odometry import WheelOdometry, ros_covariance


class OdometryTests(unittest.TestCase):
    def test_forward_and_reverse_from_encoder_deltas(self):
        odom = WheelOdometry(0.2, 1.0, x=2, y=3)
        odom.update(5, 5, 1)
        self.assertAlmostEqual(odom.x, 3)
        self.assertAlmostEqual(odom.linear_velocity, 1)
        odom.update(0, 0, 2)
        self.assertAlmostEqual(odom.x, 2)
        self.assertAlmostEqual(odom.y, 3)
        self.assertAlmostEqual(odom.linear_velocity, -0.5)
        self.assertAlmostEqual(odom.distance, 2)

    def test_pure_rotation_and_wrap(self):
        odom = WheelOdometry(0.2, 1.0, x=2, y=3)
        odom.update(-10, 10, 2)
        self.assertEqual((odom.x, odom.y), (2, 3))
        self.assertAlmostEqual(odom.yaw, 4 - math.tau)
        self.assertAlmostEqual(odom.angular_velocity, 2)
        self.assertEqual(odom.distance, 0)

    def test_exact_quarter_circle(self):
        odom = WheelOdometry(1, 1)
        odom.update(math.pi / 4, 3 * math.pi / 4, 1)
        self.assertAlmostEqual(odom.x, 1)
        self.assertAlmostEqual(odom.y, 1)
        self.assertAlmostEqual(odom.yaw, math.pi / 2)

    def test_full_circle_has_no_closure_error(self):
        odom = WheelOdometry(1, 1)
        for index in range(1, 1001):
            odom.update(index * math.pi / 1000, index * 3 * math.pi / 1000, 0.01)
        self.assertAlmostEqual(odom.x, 0, places=10)
        self.assertAlmostEqual(odom.y, 0, places=10)
        self.assertAlmostEqual(odom.yaw, 0, places=10)

    def test_initial_heading(self):
        odom = WheelOdometry(1, 1, x=2, y=3, yaw=math.pi / 2)
        odom.update(1, 1, 1)
        self.assertAlmostEqual(odom.x, 2)
        self.assertAlmostEqual(odom.y, 4)

    def test_tiny_angular_displacement_is_stable(self):
        odom = WheelOdometry(1, 1)
        odom.update(1, 1 + 1e-12, 1)
        self.assertAlmostEqual(odom.x, 1)
        self.assertAlmostEqual(odom.y, 5e-13, places=14)
        self.assertTrue(all(math.isfinite(v) for row in odom.covariance for v in row))

    def test_equal_calibration_bias_produces_known_drift(self):
        odom = WheelOdometry(1, 1, left_scale=1.01, right_scale=1.01)
        odom.update(10, 10, 10)
        position, heading = odom.errors(10, 0, 0)
        self.assertAlmostEqual(position, 0.1)
        self.assertAlmostEqual(heading, 0)

    def test_asymmetric_calibration_bias_produces_known_arc(self):
        odom = WheelOdometry(1, 1, left_scale=0.99, right_scale=1.01)
        odom.update(10, 10, 10)
        self.assertAlmostEqual(odom.yaw, 0.2)
        self.assertAlmostEqual(odom.x, 50 * math.sin(0.2))
        self.assertAlmostEqual(odom.y, 50 * (1 - math.cos(0.2)))

    def test_stopped_or_blocked_encoders_do_not_drift(self):
        odom = WheelOdometry(1, 1, left_scale=0.98, right_scale=1.02)
        odom.update(1, 1, 1)
        before = (odom.x, odom.y, odom.yaw, odom.distance)
        covariance = [row[:] for row in odom.covariance]
        for _ in range(100):
            odom.update(1, 1, 0.02)
        self.assertEqual((odom.x, odom.y, odom.yaw, odom.distance), before)
        self.assertEqual(odom.covariance, covariance)
        self.assertEqual((odom.linear_velocity, odom.angular_velocity), (0, 0))

    def test_covariance_grows_and_is_positive_semidefinite(self):
        odom = WheelOdometry(0.19, 0.94)
        initial_yaw_variance = odom.covariance[2][2]
        for index in range(1, 101):
            odom.update(index * 0.03, index * 0.05, 0.02)
        covariance = odom.covariance
        self.assertGreater(covariance[2][2], initial_yaw_variance)
        for i in range(3):
            for j in range(3):
                self.assertAlmostEqual(covariance[i][j], covariance[j][i])
        for vector in ([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, -3, 2], [-2, 1, 4]):
            quadratic = sum(vector[i] * covariance[i][j] * vector[j] for i in range(3) for j in range(3))
            self.assertGreaterEqual(quadratic, 0)

    def test_covariance_jacobian_matches_finite_differences(self):
        # Compare wheel-noise propagation to a numerical derivative of the exact arc.
        from agv_web_bridge.odometry import integrate_pose
        odom = WheelOdometry(1, 0.94, variance_per_meter=0.001)
        odom.covariance = [[0.0] * 3 for _ in range(3)]
        left, right, epsilon = 0.2, 0.3, 1e-6
        gradients = []
        for dl, dr in ((epsilon, 0), (0, epsilon)):
            plus = integrate_pose(0, 0, 0, left + dl, right + dr, 0.94)
            minus = integrate_pose(0, 0, 0, left - dl, right - dr, 0.94)
            gradients.append([(a - b) / (2 * epsilon) for a, b in zip(plus, minus)])
        odom.update(left, right, 1)
        for i in range(3):
            for j in range(3):
                expected = sum(gradients[k][i] * gradients[k][j] * 0.001 * d
                               for k, d in enumerate((left, right)))
                self.assertAlmostEqual(odom.covariance[i][j], expected, places=10)

    def test_ros_covariance_indices(self):
        result = ros_covariance([[1, 2, 3], [2, 4, 5], [3, 5, 6]])
        self.assertEqual(len(result), 36)
        self.assertEqual([result[i] for i in (0, 1, 5, 6, 7, 11, 30, 31, 35)], [1, 2, 3, 2, 4, 5, 3, 5, 6])
        self.assertEqual([result[i] for i in (14, 21, 28)], [1e6] * 3)

    def test_invalid_parameters_and_inputs(self):
        for kwargs in ({'radius': 0}, {'separation': -1}, {'left_scale': math.nan},
                       {'right_scale': 0}, {'variance_per_meter': -1}, {'x': math.inf}):
            parameters = dict(radius=0.19, separation=0.94)
            parameters.update(kwargs)
            with self.assertRaises(ValueError):
                WheelOdometry(**parameters)
        odom = WheelOdometry(1, 1)
        for angles in ((0, 0, 0), (math.inf, 0, 1), (0, 0, -1)):
            with self.assertRaises(ValueError):
                odom.update(*angles)
        self.assertEqual(odom.x, 0)

    def test_heading_error_wraps(self):
        odom = WheelOdometry(1, 1, yaw=math.pi - 0.01)
        self.assertAlmostEqual(odom.errors(0, 0, -math.pi + 0.01)[1], -0.02)


if __name__ == '__main__':
    unittest.main()

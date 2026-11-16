"""Wheel encoder odometry and planar uncertainty, independent of ROS."""
from __future__ import annotations

import math
from dataclasses import dataclass, field


def integrate_pose(x: float, y: float, yaw: float, left: float, right: float,
                   separation: float) -> tuple[float, float, float]:
    """Exact constant-curvature integration of wheel distances in metres."""
    turn = (right - left) / separation
    half = turn * 0.5
    sinc = math.sin(half) / half if abs(half) > 1e-8 else 1 - half * half / 6
    distance = (left + right) * 0.5 * sinc
    return (x + distance * math.cos(yaw + half),
            y + distance * math.sin(yaw + half),
            math.atan2(math.sin(yaw + turn), math.cos(yaw + turn)))


def ros_covariance(planar: list[list[float]], unobserved: float = 1e6) -> list[float]:
    """Map x,y,yaw into the ROS row-major x,y,z,roll,pitch,yaw matrix."""
    result = [0.0] * 36
    for row, axis in enumerate((0, 1, 5)):
        for column, other in enumerate((0, 1, 5)):
            result[axis * 6 + other] = planar[row][column]
    for axis in (2, 3, 4):
        result[axis * 6 + axis] = unobserved
    return result


@dataclass
class WheelOdometry:
    radius: float
    separation: float
    x: float = 0.0
    y: float = 0.0
    yaw: float = 0.0
    left_scale: float = 1.0
    right_scale: float = 1.0
    variance_per_meter: float = 0.0001
    linear_velocity: float = field(default=0.0, init=False)
    angular_velocity: float = field(default=0.0, init=False)
    distance: float = field(default=0.0, init=False)
    covariance: list[list[float]] = field(default_factory=lambda: [
        [0.002, 0.0, 0.0], [0.0, 0.002, 0.0], [0.0, 0.0, 0.004]], init=False)
    twist_covariance: list[float] = field(default_factory=lambda: ros_covariance([
        [1e-6, 0.0, 0.0], [0.0, 1e6, 0.0], [0.0, 0.0, 1e-6]]), init=False)
    _left: float = field(default=0.0, init=False)
    _right: float = field(default=0.0, init=False)

    def __post_init__(self) -> None:
        positive = (self.radius, self.separation, self.left_scale, self.right_scale)
        if any(not math.isfinite(v) or v <= 0 for v in positive):
            raise ValueError('Wheel geometry and encoder scales must be finite and positive')
        if not math.isfinite(self.variance_per_meter) or self.variance_per_meter < 0:
            raise ValueError('Wheel variance per metre must be finite and nonnegative')
        if not all(math.isfinite(v) for v in (self.x, self.y, self.yaw)):
            raise ValueError('Initial pose must be finite')

    def update(self, left_angle: float, right_angle: float, dt: float) -> None:
        """Consume cumulative encoder angles in radians; never commanded velocity."""
        if not all(math.isfinite(v) for v in (left_angle, right_angle, dt)) or dt <= 0:
            raise ValueError('Encoder angles must be finite and dt must be positive')
        left = (left_angle - self._left) * self.radius * self.left_scale
        right = (right_angle - self._right) * self.radius * self.right_scale
        self._left, self._right = left_angle, right_angle
        distance, turn = (left + right) * 0.5, (right - left) / self.separation
        self.linear_velocity, self.angular_velocity = distance / dt, turn / dt
        self.distance += abs(distance)
        half = turn * 0.5
        sinc = math.sin(half) / half if abs(half) > 1e-8 else 1 - half * half / 6
        derivative = ((half * math.cos(half) - math.sin(half)) / (2 * half ** 2)
                      if abs(half) > 1e-5 else -turn / 12)
        cosine, sine = math.cos(self.yaw + half), math.sin(self.yaw + half)
        dx, dy = distance * sinc * cosine, distance * sinc * sine
        f = [[1.0, 0.0, -dy], [0.0, 1.0, dx], [0.0, 0.0, 1.0]]
        g = [[0.0, 0.0] for _ in range(3)]
        for index, sign in enumerate((-1, 1)):
            dturn = sign / self.separation
            g[0][index] = 0.5 * sinc * cosine + distance * (derivative * cosine - 0.5 * sinc * sine) * dturn
            g[1][index] = 0.5 * sinc * sine + distance * (derivative * sine + 0.5 * sinc * cosine) * dturn
            g[2][index] = dturn
        variances = [self.variance_per_meter * abs(left), self.variance_per_meter * abs(right)]
        self.covariance = [[
            sum(f[i][a] * self.covariance[a][b] * f[j][b] for a in range(3) for b in range(3))
            + sum(g[i][k] * variances[k] * g[j][k] for k in range(2))
            for j in range(3)] for i in range(3)]
        vl, vr = (v / dt ** 2 for v in variances)
        cross = (vr - vl) / (2 * self.separation)
        self.twist_covariance = ros_covariance([
            [1e-6 + (vl + vr) / 4, 0.0, cross],
            [0.0, 1e6, 0.0],
            [cross, 0.0, 1e-6 + (vl + vr) / self.separation ** 2]])
        self.x, self.y, self.yaw = integrate_pose(self.x, self.y, self.yaw, left, right, self.separation)

    def errors(self, truth_x: float, truth_y: float, truth_yaw: float) -> tuple[float, float]:
        return (math.hypot(self.x - truth_x, self.y - truth_y),
                math.atan2(math.sin(self.yaw - truth_yaw), math.cos(self.yaw - truth_yaw)))

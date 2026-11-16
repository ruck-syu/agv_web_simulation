"""ROS-independent planar ray casting against the authoritative obstacle shapes."""
from __future__ import annotations

import math
try:
    import numpy as np
except ImportError:
    np = None
from typing import Iterable, Protocol

LIDAR_HEIGHT = 1.02  # Fixed roof mount, directly above base_link (metres).
LIDAR_FRAME = 'laser_frame'


class ScanObstacle(Protocol):
    cx: float
    cy: float
    hx: float
    hy: float
    yaw: float
    shape: str
    min_z: float
    max_z: float


def ray_distance(obstacle: ScanObstacle, x: float, y: float, angle: float) -> float:
    """First nonnegative intersection; infinity for misses, zero if inside."""
    cosine, sine = math.cos(obstacle.yaw), math.sin(obstacle.yaw)
    dx, dy = x - obstacle.cx, y - obstacle.cy
    ox, oy = dx * cosine + dy * sine, -dx * sine + dy * cosine
    vx, vy = math.cos(angle - obstacle.yaw), math.sin(angle - obstacle.yaw)
    if obstacle.shape == 'circle':
        if ox * ox + oy * oy <= obstacle.hx ** 2:
            return 0.0
        projection = ox * vx + oy * vy
        discriminant = projection ** 2 - (ox * ox + oy * oy - obstacle.hx ** 2)
        if discriminant < -1e-10:
            return math.inf
        distance = -projection - math.sqrt(max(0.0, discriminant))
        return distance if distance >= 0 else math.inf
    near, far = 0.0, math.inf
    for origin, direction, half_size in ((ox, vx, obstacle.hx), (oy, vy, obstacle.hy)):
        if abs(direction) < 1e-12:
            if abs(origin) > half_size:
                return math.inf
            continue
        first, second = (-half_size - origin) / direction, (half_size - origin) / direction
        near, far = max(near, min(first, second)), min(far, max(first, second))
        if near > far:
            return math.inf
    return near


def scan_ranges(obstacles: Iterable[ScanObstacle], x: float, y: float, yaw: float,
                samples: int = 360, range_min: float = 0.05,
                range_max: float = 30.0, height: float = LIDAR_HEIGHT) -> list[float]:
    """Instantaneous 360° scan. No return is +inf, below minimum is -inf.

    Do not clamp blind-zone hits to range_min or see through close obstacles.
    Only geometry intersecting the sensor plane contributes returns.
    """
    if samples < 4 or not 0 <= range_min < range_max:
        raise ValueError('Invalid LiDAR sample count or range limits')
    visible = [o for o in obstacles if o.min_z <= height <= o.max_z]
    if np is not None:
        return _batch_ranges(visible, x, y, yaw, samples, range_min, range_max)
    result = []
    for index in range(samples):
        angle = yaw - math.pi + index * math.tau / samples
        distance = min((ray_distance(o, x, y, angle) for o in visible), default=math.inf)
        result.append(-math.inf if distance < range_min else
                      distance if distance <= range_max else math.inf)
    return result


def _batch_ranges(obstacles, x, y, yaw, samples, range_min, range_max):
    """Broadcast slab/circle intersections over all beams to keep ROS timers responsive."""
    angles = yaw - math.pi + np.arange(samples) * math.tau / samples
    vx, vy = np.cos(angles)[None, :], np.sin(angles)[None, :]
    distances = np.full(samples, np.inf)
    boxes = [o for o in obstacles if o.shape != 'circle']
    if boxes:
        cosine = np.array([math.cos(o.yaw) for o in boxes])[:, None]
        sine = np.array([math.sin(o.yaw) for o in boxes])[:, None]
        dx = np.array([x - o.cx for o in boxes])[:, None]
        dy = np.array([y - o.cy for o in boxes])[:, None]
        ox, oy = dx * cosine + dy * sine, -dx * sine + dy * cosine
        rx, ry = vx * cosine + vy * sine, -vx * sine + vy * cosine
        near = np.zeros((len(boxes), samples))
        far = np.full((len(boxes), samples), np.inf)
        for origin, direction, sizes in ((ox, rx, [o.hx for o in boxes]), (oy, ry, [o.hy for o in boxes])):
            size = np.array(sizes)[:, None]
            parallel = np.abs(direction) < 1e-12
            denominator = np.where(parallel, 1.0, direction)
            first, second = (-size - origin) / denominator, (size - origin) / denominator
            low, high = np.minimum(first, second), np.maximum(first, second)
            low = np.where(parallel, np.where(np.abs(origin) <= size, -np.inf, np.inf), low)
            high = np.where(parallel, np.inf, high)
            near, far = np.maximum(near, low), np.minimum(far, high)
        distances = np.minimum(distances, np.min(np.where(near <= far, near, np.inf), axis=0))
    circles = [o for o in obstacles if o.shape == 'circle']
    if circles:
        ox = np.array([x - o.cx for o in circles])[:, None]
        oy = np.array([y - o.cy for o in circles])[:, None]
        radii = np.array([o.hx for o in circles])[:, None]
        projection = ox * vx + oy * vy
        discriminant = projection ** 2 - (ox ** 2 + oy ** 2 - radii ** 2)
        hit = -projection - np.sqrt(np.maximum(0.0, discriminant))
        hit = np.where((discriminant >= -1e-10) & (hit >= 0.0), hit, np.inf)
        hit = np.where(ox ** 2 + oy ** 2 <= radii ** 2, 0.0, hit)
        distances = np.minimum(distances, np.min(hit, axis=0))
    return np.where(distances < range_min, -np.inf, np.where(distances <= range_max, distances, np.inf)).tolist()

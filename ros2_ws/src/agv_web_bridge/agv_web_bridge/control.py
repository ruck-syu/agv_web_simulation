"""Command selection and goal validation, independent of ROS callbacks."""
import math
from dataclasses import dataclass
from .motion_limits import MAX_LINEAR_SPEED, MAX_ANGULAR_SPEED


FLEET_WORLD_BOUNDS = (-31, 31, -19, 19)


def goal_coordinates(payload):
    if not isinstance(payload, dict) or payload.get('action') != 'goal':
        return None
    values = [payload.get(key) for key in ('x', 'y', 'yaw')]
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in values):
        return None
    try:
        return tuple(float(v) for v in values) if all(math.isfinite(v) for v in values) else None
    except OverflowError:
        return None


def valid_goal(payload):
    """Validate the input range of the legacy navigation bridge."""
    values = goal_coordinates(payload)
    if values is None or abs(values[0]) > 100 or abs(values[1]) > 100:
        return None
    return values


@dataclass
class CommandArbiter:
    mode: str = 'manual'
    manual: tuple = (0.0, 0.0)
    navigation: tuple = (0.0, 0.0)
    manual_time: float = -math.inf
    navigation_time: float = -math.inf
    heartbeat_time: float = -math.inf
    odom_time: float = -math.inf
    scan_time: float = -math.inf

    def sensors_ready(self, now):
        return all(0 <= now - stamp < 1.5 for stamp in (self.odom_time, self.scan_time))

    def operator_ready(self, now):
        return 0 <= now - self.heartbeat_time < 2.0

    def start(self):
        self.mode = 'autonomous'
        self.navigation = (0.0, 0.0)
        self.navigation_time = -math.inf

    def stop(self):
        self.mode = 'manual'
        self.manual = self.navigation = (0.0, 0.0)
        self.manual_time = self.navigation_time = -math.inf

    def receive_manual(self, linear, angular, now):
        if not all(math.isfinite(v) for v in (linear, angular)):
            return False
        self.mode = 'manual'
        self.manual = (max(-MAX_LINEAR_SPEED, min(MAX_LINEAR_SPEED, linear)),
                       max(-MAX_ANGULAR_SPEED, min(MAX_ANGULAR_SPEED, angular)))
        self.manual_time = now
        return True

    def receive_navigation(self, linear, angular, now):
        if self.mode != 'autonomous' or not all(math.isfinite(v) for v in (linear, angular)):
            return
        self.navigation = (max(-MAX_LINEAR_SPEED, min(MAX_LINEAR_SPEED, linear)),
                       max(-MAX_ANGULAR_SPEED, min(MAX_ANGULAR_SPEED, angular)))
        self.navigation_time = now

    def command(self, now):
        if self.mode == 'autonomous':
            if self.sensors_ready(now) and self.operator_ready(now) and 0 <= now - self.navigation_time < 0.3:
                return self.navigation
        elif 0 <= now - self.manual_time < 0.3:
            return self.manual
        return (0.0, 0.0)

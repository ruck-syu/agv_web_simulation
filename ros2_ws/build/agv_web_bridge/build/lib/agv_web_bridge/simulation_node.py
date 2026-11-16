"""Authoritative differential-drive AGV simulation with 2D warehouse collisions."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import rclpy
from ament_index_python.packages import get_package_share_directory
from geometry_msgs.msg import Quaternion, TransformStamped, Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import String
from tf2_ros import TransformBroadcaster

CMD_VEL_TOPIC = '/cmd_vel'
ODOM_TOPIC = '/odom'
JOINT_STATE_TOPIC = '/joint_states'
COLLISION_TOPIC = '/agv_web/collision_status'
COLLISION_GEOMETRY_TOPIC = '/agv_web/collision_geometry'
ODOM_FRAME = 'odom'
BASE_FRAME = 'base_link'
LEFT_JOINT = 'left_wheel_joint'
RIGHT_JOINT = 'right_wheel_joint'
LAST_CONTACT_HOLD_SEC = 5.0
EPS = 1.0e-9


@dataclass(frozen=True)
class Obstacle:
    """Oriented rectangle in the odom plane."""

    id: str
    type: str
    cx: float
    cy: float
    hx: float
    hy: float
    yaw: float
    shape: str = 'box'

    @property
    def cosine(self) -> float:
        return math.cos(self.yaw)

    @property
    def sine(self) -> float:
        return math.sin(self.yaw)


def normalize_angle(angle: float) -> float:
    return math.atan2(math.sin(angle), math.cos(angle))


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def move_towards(current: float, target: float, maximum_delta: float) -> float:
    if target > current:
        return min(target, current + maximum_delta)
    return max(target, current - maximum_delta)


def quaternion_from_yaw(yaw: float) -> Quaternion:
    quaternion = Quaternion()
    quaternion.x = 0.0
    quaternion.y = 0.0
    quaternion.z = math.sin(yaw * 0.5)
    quaternion.w = math.cos(yaw * 0.5)
    return quaternion


def obb_overlap(
    ax: float,
    ay: float,
    ahx: float,
    ahy: float,
    ayaw: float,
    bx: float,
    by: float,
    bhx: float,
    bhy: float,
    byaw: float,
) -> bool:
    """Separating-axis test for two oriented rectangles."""

    acos = math.cos(ayaw)
    asin = math.sin(ayaw)
    bcos = math.cos(byaw)
    bsin = math.sin(byaw)
    dx = bx - ax
    dy = by - ay

    axes = (
        (acos, asin),
        (-asin, acos),
        (bcos, bsin),
        (-bsin, bcos),
    )

    for axis_x, axis_y in axes:
        a_radius = ahx * abs(axis_x * acos + axis_y * asin) + ahy * abs(
            -axis_x * asin + axis_y * acos
        )
        b_radius = bhx * abs(axis_x * bcos + axis_y * bsin) + bhy * abs(
            -axis_x * bsin + axis_y * bcos
        )
        distance = abs(dx * axis_x + dy * axis_y)
        if distance > a_radius + b_radius + EPS:
            return False
    return True


def circle_overlaps_obb(
    cx: float,
    cy: float,
    radius: float,
    rx: float,
    ry: float,
    rhx: float,
    rhy: float,
    ryaw: float,
) -> bool:
    """Return True when a circle overlaps an oriented rectangle."""

    dx = cx - rx
    dy = cy - ry
    cosine = math.cos(ryaw)
    sine = math.sin(ryaw)
    local_x = dx * cosine + dy * sine
    local_y = -dx * sine + dy * cosine
    closest_x = clamp(local_x, -rhx, rhx)
    closest_y = clamp(local_y, -rhy, rhy)
    return math.hypot(local_x - closest_x, local_y - closest_y) <= radius + EPS


def obstacle_contains_pose(
    obstacle: Obstacle,
    x: float,
    y: float,
    yaw: float,
    half_length: float,
    half_width: float,
) -> bool:
    if obstacle.shape == 'circle':
        return circle_overlaps_obb(
            obstacle.cx,
            obstacle.cy,
            obstacle.hx,
            x,
            y,
            half_length,
            half_width,
            yaw,
        )
    return obb_overlap(
        x,
        y,
        half_length,
        half_width,
        yaw,
        obstacle.cx,
        obstacle.cy,
        obstacle.hx,
        obstacle.hy,
        obstacle.yaw,
    )


def closest_point_on_obstacle(
    obstacle: Obstacle, x: float, y: float
) -> tuple[float, float]:
    """Closest point on an obstacle boundary to a world-space point."""

    dx = x - obstacle.cx
    dy = y - obstacle.cy
    if obstacle.shape == 'circle':
        distance = math.hypot(dx, dy)
        if distance < EPS:
            return obstacle.cx + obstacle.hx, obstacle.cy
        scale = obstacle.hx / distance
        return obstacle.cx + dx * scale, obstacle.cy + dy * scale

    cosine = obstacle.cosine
    sine = obstacle.sine
    local_x = dx * cosine + dy * sine
    local_y = -dx * sine + dy * cosine
    inside = abs(local_x) <= obstacle.hx and abs(local_y) <= obstacle.hy
    if inside:
        if obstacle.hx - abs(local_x) < obstacle.hy - abs(local_y):
            local_x = math.copysign(obstacle.hx, local_x if local_x else 1.0)
        else:
            local_y = math.copysign(obstacle.hy, local_y if local_y else 1.0)
    else:
        local_x = clamp(local_x, -obstacle.hx, obstacle.hx)
        local_y = clamp(local_y, -obstacle.hy, obstacle.hy)
    return (
        obstacle.cx + local_x * cosine - local_y * sine,
        obstacle.cy + local_x * sine + local_y * cosine,
    )


def find_collision(
    obstacles: list[Obstacle],
    x: float,
    y: float,
    yaw: float,
    half_length: float,
    half_width: float,
) -> Optional[Obstacle]:
    for obstacle in obstacles:
        if obstacle_contains_pose(
            obstacle, x, y, yaw, half_length, half_width
        ):
            return obstacle
    return None


def obb_contact_point(
    ax: float,
    ay: float,
    ahx: float,
    ahy: float,
    ayaw: float,
    bx: float,
    by: float,
    bhx: float,
    bhy: float,
    byaw: float,
) -> Optional[tuple[float, float]]:
    """Approximate the contact point for two intersecting oriented rectangles.

    The midpoint of the support points on the minimum-penetration SAT axis is
    used. It lies on the touching corner/edge pair and is accurate enough for
    a collision debug marker.
    """

    acos = math.cos(ayaw)
    asin = math.sin(ayaw)
    bcos = math.cos(byaw)
    bsin = math.sin(byaw)
    axes = (
        (acos, asin),
        (-asin, acos),
        (bcos, bsin),
        (-bsin, bcos),
    )

    best_axis: Optional[tuple[float, float]] = None
    best_sign = 1.0
    best_overlap = float('inf')
    for axis_x, axis_y in axes:
        a_radius = ahx * abs(axis_x * acos + axis_y * asin) + ahy * abs(
            -axis_x * asin + axis_y * acos
        )
        b_radius = bhx * abs(axis_x * bcos + axis_y * bsin) + bhy * abs(
            -axis_x * bsin + axis_y * bcos
        )
        center_delta = (bx - ax) * axis_x + (by - ay) * axis_y
        overlap = a_radius + b_radius - abs(center_delta)
        if overlap < -EPS:
            return None
        if overlap < best_overlap:
            best_overlap = overlap
            best_axis = (axis_x, axis_y)
            best_sign = 1.0 if center_delta >= 0.0 else -1.0

    if best_axis is None:
        return None
    normal_x = best_axis[0] * best_sign
    normal_y = best_axis[1] * best_sign

    a_support_x = ahx * math.copysign(1.0, normal_x * acos + normal_y * asin)
    a_support_y = ahy * math.copysign(1.0, normal_x * -asin + normal_y * acos)
    b_support_x = bhx * math.copysign(1.0, -normal_x * bcos + -normal_y * bsin)
    b_support_y = bhy * math.copysign(1.0, -normal_x * -bsin + -normal_y * bcos)

    point_a_x = ax + a_support_x * acos - a_support_y * asin
    point_a_y = ay + a_support_x * asin + a_support_y * acos
    point_b_x = bx + b_support_x * bcos - b_support_y * bsin
    point_b_y = by + b_support_x * bsin + b_support_y * bcos
    return ((point_a_x + point_b_x) * 0.5, (point_a_y + point_b_y) * 0.5)


def contact_point_with_obstacle(
    obstacle: Obstacle,
    x: float,
    y: float,
    yaw: float,
    half_length: float,
    half_width: float,
) -> tuple[float, float]:
    if obstacle.shape == 'box':
        contact = obb_contact_point(
            x,
            y,
            half_length,
            half_width,
            yaw,
            obstacle.cx,
            obstacle.cy,
            obstacle.hx,
            obstacle.hy,
            obstacle.yaw,
        )
        if contact is not None:
            return contact
    return closest_point_on_obstacle(obstacle, x, y)


class SimulationNode(Node):
    """Fixed-step differential drive, odometry, TF and collision publisher."""

    def __init__(self) -> None:
        super().__init__('agv_web_simulation')

        default_config = self._default_config_path()
        self.declare_parameter('config_file', default_config)
        config_path = str(self.get_parameter('config_file').value)
        config = self._load_config(config_path)
        robot = config['robot']
        initial = robot['initial_pose']

        self.declare_parameter('wheel_radius', float(robot['wheel_radius']))
        self.declare_parameter('wheel_separation', float(robot['wheel_separation']))
        self.declare_parameter('footprint_length', float(robot['footprint_length']))
        self.declare_parameter('footprint_width', float(robot['footprint_width']))
        self.declare_parameter('footprint_padding', float(robot.get('footprint_padding', 0.0)))
        self.declare_parameter('initial_x', float(initial['x']))
        self.declare_parameter('initial_y', float(initial['y']))
        self.declare_parameter('initial_yaw', float(initial['yaw']))
        self.declare_parameter('max_linear_velocity', 0.6)
        self.declare_parameter('max_angular_velocity', 1.2)
        self.declare_parameter('max_wheel_angular_velocity', 3.2)
        self.declare_parameter('max_linear_acceleration', 1.2)
        self.declare_parameter('max_angular_acceleration', 2.5)
        self.declare_parameter('cmd_vel_timeout', 0.5)
        self.declare_parameter('simulation_rate', 50.0)
        self.declare_parameter('odometry_rate', 25.0)
        self.declare_parameter('collision_status_rate', 10.0)

        self.wheel_radius = float(self.get_parameter('wheel_radius').value)
        self.wheel_separation = float(self.get_parameter('wheel_separation').value)
        self.footprint_length = float(self.get_parameter('footprint_length').value)
        self.footprint_width = float(self.get_parameter('footprint_width').value)
        self.footprint_padding = float(self.get_parameter('footprint_padding').value)
        self.max_linear_velocity = float(self.get_parameter('max_linear_velocity').value)
        self.max_angular_velocity = float(self.get_parameter('max_angular_velocity').value)
        self.max_wheel_angular_velocity = float(
            self.get_parameter('max_wheel_angular_velocity').value
        )
        self.max_linear_acceleration = float(
            self.get_parameter('max_linear_acceleration').value
        )
        self.max_angular_acceleration = float(
            self.get_parameter('max_angular_acceleration').value
        )
        self.cmd_vel_timeout = float(self.get_parameter('cmd_vel_timeout').value)
        simulation_rate = max(10.0, float(self.get_parameter('simulation_rate').value))
        odometry_rate = max(1.0, float(self.get_parameter('odometry_rate').value))
        collision_rate = max(1.0, float(self.get_parameter('collision_status_rate').value))

        self.dt = 1.0 / simulation_rate
        self.odometry_every = max(1, round(simulation_rate / odometry_rate))
        self.collision_every = max(1, round(simulation_rate / collision_rate))

        self.x = float(self.get_parameter('initial_x').value)
        self.y = float(self.get_parameter('initial_y').value)
        self.yaw = normalize_angle(float(self.get_parameter('initial_yaw').value))
        self.v = 0.0
        self.w = 0.0
        self.target_v = 0.0
        self.target_w = 0.0
        self.left_wheel_angle = 0.0
        self.right_wheel_angle = 0.0
        self.left_wheel_velocity = 0.0
        self.right_wheel_velocity = 0.0
        self.last_cmd_time: Optional[float] = None
        self.cmd_timed_out = False
        self.blocked_now = False
        self.blocked_command: Optional[tuple[float, float]] = None
        self.blocked_obstacle: Optional[Obstacle] = None
        self.last_contact_point: Optional[tuple[float, float]] = None
        self.last_object_id: Optional[str] = None
        self.last_object_type: Optional[str] = None
        self.last_blocked_time: Optional[float] = None
        self.step_index = 0

        self.obstacles = self._build_obstacles(config)
        self.half_length = self.footprint_length * 0.5 + self.footprint_padding
        self.half_width = self.footprint_width * 0.5 + self.footprint_padding
        initial_collision = self._current_collision()
        if initial_collision is not None:
            raise RuntimeError(
                'Initial AGV pose collides with '
                f'{initial_collision.id} ({initial_collision.type}); refusing to start.'
            )

        self.create_subscription(Twist, CMD_VEL_TOPIC, self._handle_cmd_vel, 10)
        self.odom_publisher = self.create_publisher(Odometry, ODOM_TOPIC, 10)
        self.joint_publisher = self.create_publisher(JointState, JOINT_STATE_TOPIC, 10)
        self.collision_publisher = self.create_publisher(String, COLLISION_TOPIC, 10)
        self.geometry_publisher = self.create_publisher(
            String, COLLISION_GEOMETRY_TOPIC, 10
        )
        self.tf_broadcaster = TransformBroadcaster(self)
        self.create_timer(self.dt, self._step)
        self.create_timer(1.0, self._publish_collision_geometry)

        self.get_logger().info(
            'AGV simulation ready: '
            f'{len(self.obstacles)} collision objects, dt={self.dt:.3f}s, '
            f'pose=({self.x:.3f}, {self.y:.3f}, {self.yaw:.3f}), '
            f'wheel radius={self.wheel_radius:.3f}m, '
            f'wheel separation={self.wheel_separation:.3f}m, '
            f'footprint={self.footprint_length:.2f}x{self.footprint_width:.2f}m.'
        )
        self.get_logger().info(
            f'Subscribing {CMD_VEL_TOPIC}; publishing {ODOM_TOPIC}, '
            f'{JOINT_STATE_TOPIC}, {COLLISION_TOPIC}, '
            f'{COLLISION_GEOMETRY_TOPIC} and TF {ODOM_FRAME}->{BASE_FRAME}.'
        )

    @staticmethod
    def _default_config_path() -> str:
        try:
            share = Path(get_package_share_directory('agv_web_bridge'))
            installed = share / 'config' / 'warehouse_collision.json'
            if installed.exists():
                return str(installed)
        except Exception:
            pass
        return str(
            Path(__file__).resolve().parent.parent / 'config' / 'warehouse_collision.json'
        )

    @staticmethod
    def _load_config(path: str) -> dict:
        if not os.path.exists(path):
            raise FileNotFoundError(f'Collision geometry file not found: {path}')
        with open(path, 'r', encoding='utf-8') as handle:
            config = json.load(handle)
        if not config.get('obstacles'):
            raise ValueError('Collision geometry contains no obstacles.')
        return config

    @staticmethod
    def _build_obstacles(config: dict) -> list[Obstacle]:
        obstacles: list[Obstacle] = []
        for item in config['obstacles']:
            obstacles.append(
                Obstacle(
                    id=str(item['id']),
                    type=str(item['type']),
                    cx=float(item['cx']),
                    cy=float(item['cy']),
                    hx=float(item['hx']),
                    hy=float(item['hy']),
                    yaw=float(item.get('yaw', 0.0)),
                    shape=str(item.get('shape', 'box')),
                )
            )
        return obstacles

    def _now_seconds(self) -> float:
        return self.get_clock().now().nanoseconds * 1.0e-9

    def _current_collision(self) -> Optional[Obstacle]:
        return find_collision(
            self.obstacles,
            self.x,
            self.y,
            self.yaw,
            self.half_length,
            self.half_width,
        )

    def _pose_collision(self, x: float, y: float, yaw: float) -> Optional[Obstacle]:
        return find_collision(
            self.obstacles,
            x,
            y,
            yaw,
            self.half_length,
            self.half_width,
        )

    def _handle_cmd_vel(self, message: Twist) -> None:
        linear = float(message.linear.x)
        angular = float(message.angular.z)
        if not (math.isfinite(linear) and math.isfinite(angular)):
            self.get_logger().warning('Ignored non-finite /cmd_vel command.')
            return
        new_v = clamp(linear, -self.max_linear_velocity, self.max_linear_velocity)
        new_w = clamp(angular, -self.max_angular_velocity, self.max_angular_velocity)
        if self.blocked_now and self.blocked_command is not None:
            changed = (
                abs(new_v - self.blocked_command[0]) > 0.02
                or abs(new_w - self.blocked_command[1]) > 0.02
            )
            if changed:
                self.blocked_now = False
                self.blocked_command = None
                self.blocked_obstacle = None
        self.target_v = new_v
        self.target_w = new_w
        self.last_cmd_time = self._now_seconds()
        self.cmd_timed_out = False

    def _update_command_timeout(self, now: float) -> None:
        if self.last_cmd_time is None:
            self.cmd_timed_out = False
            return
        timed_out = (now - self.last_cmd_time) > self.cmd_vel_timeout
        if timed_out and not self.cmd_timed_out:
            self.get_logger().warning(
                f'No /cmd_vel received for {self.cmd_vel_timeout:.2f}s; stopping the AGV.'
            )
        self.cmd_timed_out = timed_out

    def _commit_motion(
        self,
        x: float,
        y: float,
        yaw: float,
        linear: float,
        angular: float,
    ) -> None:
        self.x = x
        self.y = y
        self.yaw = normalize_angle(yaw)
        self.v = linear
        self.w = angular
        self.left_wheel_velocity = (linear - angular * self.wheel_separation * 0.5) / (
            self.wheel_radius
        )
        self.right_wheel_velocity = (linear + angular * self.wheel_separation * 0.5) / (
            self.wheel_radius
        )
        self.left_wheel_angle += self.left_wheel_velocity * self.dt
        self.right_wheel_angle += self.right_wheel_velocity * self.dt

    def _record_block(self, obstacle: Obstacle, now: float) -> None:
        if not self.blocked_now:
            self.get_logger().warning(
                f'Collision prevented: {obstacle.id} ({obstacle.type}) blocks the AGV footprint.'
            )
        self.blocked_now = True
        self.blocked_obstacle = obstacle
        self.last_object_id = obstacle.id
        self.last_object_type = obstacle.type
        self.last_blocked_time = now

    def _step(self) -> None:
        now = self._now_seconds()
        self._update_command_timeout(now)
        if self.cmd_timed_out and self.blocked_now:
            self.blocked_now = False
            self.blocked_command = None
            self.blocked_obstacle = None
        if self.blocked_now and self.blocked_command is not None:
            self.v = 0.0
            self.w = 0.0
            self.left_wheel_velocity = 0.0
            self.right_wheel_velocity = 0.0
            self.step_index += 1
            if self.step_index % self.odometry_every == 0:
                self._publish_state(now)
            if self.step_index % self.collision_every == 0:
                self._publish_collision_status(now)
            return

        target_v = 0.0 if self.cmd_timed_out else self.target_v
        target_w = 0.0 if self.cmd_timed_out else self.target_w

        proposed_v = move_towards(
            self.v, target_v, self.max_linear_acceleration * self.dt
        )
        proposed_w = move_towards(
            self.w, target_w, self.max_angular_acceleration * self.dt
        )

        left_linear = proposed_v - proposed_w * self.wheel_separation * 0.5
        right_linear = proposed_v + proposed_w * self.wheel_separation * 0.5
        maximum_wheel_linear = self.wheel_radius * self.max_wheel_angular_velocity
        left_linear = clamp(left_linear, -maximum_wheel_linear, maximum_wheel_linear)
        right_linear = clamp(right_linear, -maximum_wheel_linear, maximum_wheel_linear)
        effective_v = (left_linear + right_linear) * 0.5
        effective_w = (right_linear - left_linear) / self.wheel_separation

        if abs(effective_v) < 1.0e-5 and abs(effective_w) < 1.0e-5:
            self.v = 0.0
            self.w = 0.0
            self.left_wheel_velocity = 0.0
            self.right_wheel_velocity = 0.0
            self.blocked_now = False
            self.blocked_obstacle = None
        else:
            half_step_yaw = self.yaw + effective_w * self.dt * 0.5
            proposed_x = self.x + effective_v * math.cos(half_step_yaw) * self.dt
            proposed_y = self.y + effective_v * math.sin(half_step_yaw) * self.dt
            proposed_yaw = normalize_angle(self.yaw + effective_w * self.dt)
            collision = self._pose_collision(proposed_x, proposed_y, proposed_yaw)

            if collision is None:
                self._commit_motion(
                    proposed_x, proposed_y, proposed_yaw, effective_v, effective_w
                )
                if self.blocked_now:
                    self.get_logger().info('Collision path clear; movement resumed.')
                self.blocked_now = False
                self.blocked_obstacle = None
                self.last_contact_point = None
            else:
                self.last_contact_point = contact_point_with_obstacle(
                    collision,
                    proposed_x,
                    proposed_y,
                    proposed_yaw,
                    self.half_length,
                    self.half_width,
                )
                translation_safe = (
                    abs(effective_v) > 1.0e-5
                    and self._pose_collision(proposed_x, proposed_y, self.yaw) is None
                )
                rotation_safe = (
                    abs(effective_w) > 1.0e-5
                    and self._pose_collision(self.x, self.y, proposed_yaw) is None
                )

                if translation_safe:
                    self._commit_motion(
                        proposed_x, proposed_y, self.yaw, effective_v, 0.0
                    )
                    self._record_block(collision, now)
                elif rotation_safe:
                    self._commit_motion(
                        self.x, self.y, proposed_yaw, 0.0, effective_w
                    )
                    self._record_block(collision, now)
                else:
                    self.v = 0.0
                    self.w = 0.0
                    self.left_wheel_velocity = 0.0
                    self.right_wheel_velocity = 0.0
                    self._record_block(collision, now)
                    self.blocked_command = (self.target_v, self.target_w)

        self.step_index += 1
        if self.step_index % self.odometry_every == 0:
            self._publish_state(now)
        if self.step_index % self.collision_every == 0:
            self._publish_collision_status(now)

    def _publish_state(self, now: float) -> None:
        stamp = self.get_clock().now().to_msg()
        quaternion = quaternion_from_yaw(self.yaw)

        odometry = Odometry()
        odometry.header.stamp = stamp
        odometry.header.frame_id = ODOM_FRAME
        odometry.child_frame_id = BASE_FRAME
        odometry.pose.pose.position.x = self.x
        odometry.pose.pose.position.y = self.y
        odometry.pose.pose.position.z = 0.0
        odometry.pose.pose.orientation = quaternion
        odometry.pose.covariance[0] = 0.002
        odometry.pose.covariance[7] = 0.002
        odometry.pose.covariance[35] = 0.004
        odometry.twist.twist.linear.x = self.v
        odometry.twist.twist.linear.y = 0.0
        odometry.twist.twist.linear.z = 0.0
        odometry.twist.twist.angular.x = 0.0
        odometry.twist.twist.angular.y = 0.0
        odometry.twist.twist.angular.z = self.w
        odometry.twist.covariance[0] = 0.002
        odometry.twist.covariance[35] = 0.004
        self.odom_publisher.publish(odometry)

        joint_state = JointState()
        joint_state.header.stamp = stamp
        joint_state.name = [LEFT_JOINT, RIGHT_JOINT]
        joint_state.position = [self.left_wheel_angle, self.right_wheel_angle]
        joint_state.velocity = [self.left_wheel_velocity, self.right_wheel_velocity]
        self.joint_publisher.publish(joint_state)

        transform = TransformStamped()
        transform.header.stamp = stamp
        transform.header.frame_id = ODOM_FRAME
        transform.child_frame_id = BASE_FRAME
        transform.transform.translation.x = self.x
        transform.transform.translation.y = self.y
        transform.transform.translation.z = 0.0
        transform.transform.rotation = quaternion
        self.tf_broadcaster.sendTransform(transform)

    def _motion_state(self) -> str:
        if self.blocked_now:
            return 'blocked'
        linear = abs(self.v)
        angular = abs(self.w)
        if linear < 0.005 and angular < 0.005:
            return 'stopped'
        if self.cmd_timed_out:
            return 'timeout'
        if linear >= 0.005 and angular >= 0.02:
            return 'moving+turning'
        if linear >= 0.005:
            return 'reversing' if self.v < 0.0 else 'moving'
        return 'turning'

    def _publish_collision_geometry(self) -> None:
        obstacles = []
        for obstacle in self.obstacles:
            obstacles.append(
                {
                    'id': obstacle.id,
                    'type': obstacle.type,
                    'shape': obstacle.shape,
                    'cx': round(obstacle.cx, 4),
                    'cy': round(obstacle.cy, 4),
                    'hx': round(obstacle.hx, 4),
                    'hy': round(obstacle.hy, 4),
                    'yaw': round(obstacle.yaw, 5),
                }
            )
        payload = {
            'frame_id': ODOM_FRAME,
            'robot': {
                'footprint_length': self.footprint_length,
                'footprint_width': self.footprint_width,
                'footprint_padding': self.footprint_padding,
            },
            'obstacles': obstacles,
        }
        message = String()
        message.data = json.dumps(payload, separators=(',', ':'))
        self.geometry_publisher.publish(message)

    def _publish_collision_status(self, now: float) -> None:
        current_collision = self._current_collision()
        contact = current_collision is not None
        blocked_id = None
        blocked_type = None
        if self.blocked_now and self.last_object_id is not None:
            blocked_id = self.last_object_id
            blocked_type = self.last_object_type

        contact_obstacle = current_collision
        if contact_obstacle is None and self.blocked_now:
            contact_obstacle = self.blocked_obstacle
        contact_x = None
        contact_y = None
        if contact_obstacle is not None:
            if current_collision is not None:
                point_x, point_y = contact_point_with_obstacle(
                    current_collision,
                    self.x,
                    self.y,
                    self.yaw,
                    self.half_length,
                    self.half_width,
                )
            elif self.blocked_now and self.last_contact_point is not None:
                point_x, point_y = self.last_contact_point
            else:
                point_x, point_y = closest_point_on_obstacle(
                    contact_obstacle, self.x, self.y
                )
            contact_x = round(point_x, 4)
            contact_y = round(point_y, 4)

        last_age = None
        last_object_id = None
        last_object_type = None
        if (
            self.last_blocked_time is not None
            and (now - self.last_blocked_time) <= LAST_CONTACT_HOLD_SEC
        ):
            last_age = round(now - self.last_blocked_time, 3)
            last_object_id = self.last_object_id
            last_object_type = self.last_object_type

        if contact:
            state = 'contact'
        elif self.blocked_now:
            state = 'blocked'
        else:
            state = 'clear'

        payload = {
            'state': state,
            'collision': contact,
            'blocked': self.blocked_now,
            'blocked_object_id': blocked_id,
            'blocked_object_type': blocked_type,
            'contact_x': contact_x,
            'contact_y': contact_y,
            'last_object_id': last_object_id,
            'last_object_type': last_object_type,
            'last_blocked_age_sec': last_age,
            'motion_state': self._motion_state(),
            'command_active': (
                not self.cmd_timed_out
                and (abs(self.target_v) > 1.0e-5 or abs(self.target_w) > 1.0e-5)
            ),
            'command_timed_out': self.cmd_timed_out,
            'target_linear_velocity': round(self.target_v, 4),
            'target_angular_velocity': round(self.target_w, 4),
            'left_wheel_velocity': round(self.left_wheel_velocity, 4),
            'right_wheel_velocity': round(self.right_wheel_velocity, 4),
            'left_wheel_linear_velocity': round(
                self.left_wheel_velocity * self.wheel_radius, 4
            ),
            'right_wheel_linear_velocity': round(
                self.right_wheel_velocity * self.wheel_radius, 4
            ),
            'x': round(self.x, 4),
            'y': round(self.y, 4),
            'yaw': round(self.yaw, 4),
            'stamp': round(now, 4),
            'obstacle_count': len(self.obstacles),
        }
        message = String()
        message.data = json.dumps(payload, separators=(',', ':'))
        self.collision_publisher.publish(message)


def main(args: Optional[list[str]] = None) -> None:
    rclpy.init(args=args)
    node: Optional[SimulationNode] = None
    try:
        node = SimulationNode()
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        if node is not None:
            node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()

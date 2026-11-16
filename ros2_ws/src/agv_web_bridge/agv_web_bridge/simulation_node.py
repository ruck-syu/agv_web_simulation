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
from sensor_msgs.msg import JointState, LaserScan
from std_msgs.msg import String
from tf2_ros import TransformBroadcaster, StaticTransformBroadcaster

from .motion_limits import MAX_LINEAR_SPEED, MAX_ANGULAR_SPEED, MAX_WHEEL_ANGULAR_SPEED
from .odometry import WheelOdometry, integrate_pose, ros_covariance
from .lidar import LIDAR_FRAME, LIDAR_HEIGHT, scan_ranges

CMD_VEL_TOPIC = '/cmd_vel'
ODOM_TOPIC = '/odom'
JOINT_STATE_TOPIC = '/joint_states'
COLLISION_TOPIC = '/agv_web/collision_status'
COLLISION_GEOMETRY_TOPIC = '/agv_web/collision_geometry'
ODOM_FRAME = 'odom'
WORLD_FRAME = 'world'
TRUTH_TOPIC = '/agv_web/ground_truth'
ODOMETRY_STATUS_TOPIC = '/agv_web/odometry_status'
BASE_FRAME = 'base_link'
LEFT_JOINT = 'left_wheel_joint'
RIGHT_JOINT = 'right_wheel_joint'
LAST_CONTACT_HOLD_SEC = 5.0
EPS = 1.0e-9


@dataclass(frozen=True)
class Obstacle:
    """Oriented rectangle in the fixed warehouse world plane."""

    id: str
    type: str
    cx: float
    cy: float
    hx: float
    hy: float
    yaw: float
    shape: str = 'box'
    min_z: float = 0.0
    max_z: float = 10.0

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
    robot_height: float,
) -> Optional[Obstacle]:
    for obstacle in obstacles:
        if obstacle.min_z >= robot_height - EPS:
            continue
        if obstacle.max_z <= EPS:
            continue
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
        self.declare_parameter('robot_height', float(robot.get('height', 0.96)))
        self.declare_parameter('initial_x', float(initial['x']))
        self.declare_parameter('initial_y', float(initial['y']))
        self.declare_parameter('initial_yaw', float(initial['yaw']))
        self.declare_parameter('max_linear_velocity', MAX_LINEAR_SPEED)
        self.declare_parameter('max_angular_velocity', MAX_ANGULAR_SPEED)
        self.declare_parameter('max_wheel_angular_velocity', MAX_WHEEL_ANGULAR_SPEED)
        self.declare_parameter('max_linear_acceleration', 1.2)
        self.declare_parameter('max_angular_acceleration', 2.5)
        self.declare_parameter('cmd_vel_timeout', 0.5)
        self.declare_parameter('simulation_rate', 50.0)
        self.declare_parameter('odometry_rate', 25.0)
        self.declare_parameter('collision_status_rate', 10.0)
        self.declare_parameter('odom_left_scale', 1.0)
        self.declare_parameter('odom_right_scale', 1.0)
        self.declare_parameter('odom_variance_per_meter', 0.0001)

        self.wheel_radius = float(self.get_parameter('wheel_radius').value)
        self.wheel_separation = float(self.get_parameter('wheel_separation').value)
        self.footprint_length = float(self.get_parameter('footprint_length').value)
        self.footprint_width = float(self.get_parameter('footprint_width').value)
        self.footprint_padding = float(self.get_parameter('footprint_padding').value)
        self.robot_height = float(self.get_parameter('robot_height').value)
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
        self.wheel_odometry = WheelOdometry(
            self.wheel_radius, self.wheel_separation, self.x, self.y, self.yaw,
            left_scale=float(self.get_parameter('odom_left_scale').value),
            right_scale=float(self.get_parameter('odom_right_scale').value),
            variance_per_meter=float(self.get_parameter('odom_variance_per_meter').value),
        )
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
        self.truth_publisher = self.create_publisher(Odometry, TRUTH_TOPIC, 10)
        self.odometry_status_publisher = self.create_publisher(String, ODOMETRY_STATUS_TOPIC, 10)
        self.joint_publisher = self.create_publisher(JointState, JOINT_STATE_TOPIC, 10)
        self.collision_publisher = self.create_publisher(String, COLLISION_TOPIC, 10)
        self.geometry_publisher = self.create_publisher(
            String, COLLISION_GEOMETRY_TOPIC, 10
        )
        self.tf_broadcaster = TransformBroadcaster(self)
        # Reliable delivery also supports rosbridge's default reliable subscriber.
        self.scan_publisher = self.create_publisher(LaserScan, '/scan', 5)
        self.obstacle_scan_publisher = self.create_publisher(LaserScan, '/scan_obstacles', 5)
        self.static_tf_broadcaster = StaticTransformBroadcaster(self)
        sensor_transform = TransformStamped()
        sensor_transform.header.stamp = self.get_clock().now().to_msg()
        sensor_transform.header.frame_id = BASE_FRAME
        sensor_transform.child_frame_id = LIDAR_FRAME
        sensor_transform.transform.translation.z = LIDAR_HEIGHT
        sensor_transform.transform.rotation.w = 1.0
        obstacle_transform = TransformStamped()
        obstacle_transform.header.stamp = sensor_transform.header.stamp
        obstacle_transform.header.frame_id = BASE_FRAME
        obstacle_transform.child_frame_id = 'obstacle_laser_frame'
        obstacle_transform.transform.translation.z = 0.02
        obstacle_transform.transform.rotation.w = 1.0
        self.static_tf_broadcaster.sendTransform([sensor_transform, obstacle_transform])
        self.create_timer(0.1, self._publish_scan)
        self.create_timer(self.dt, self._step)
        self.create_timer(1.0, self._publish_collision_geometry)

        self.get_logger().info(
            'AGV simulation ready: '
            f'{len(self.obstacles)} collision objects, dt={self.dt:.3f}s, '
            f'pose=({self.x:.3f}, {self.y:.3f}, {self.yaw:.3f}), '
            f'wheel radius={self.wheel_radius:.3f}m, '
            f'wheel separation={self.wheel_separation:.3f}m, '
            f'footprint={self.footprint_length:.2f}x{self.footprint_width:.2f}m, '
            f'height={self.robot_height:.2f}m.'
        )
        self.get_logger().info(
            f'Subscribing {CMD_VEL_TOPIC}; publishing {ODOM_TOPIC}, '
            f'{JOINT_STATE_TOPIC}, {COLLISION_TOPIC}, '
            f'{COLLISION_GEOMETRY_TOPIC}, /scan, {TRUTH_TOPIC}, '
            f'{ODOMETRY_STATUS_TOPIC} and TF {ODOM_FRAME}->{BASE_FRAME}.'
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
                    min_z=float(item.get('min_z', 0.0)),
                    max_z=float(item.get('max_z', 10.0)),
                )
            )
        rack_structure = config.get('rack_structure')
        if rack_structure:
            obstacles.extend(
                SimulationNode._build_rack_obstacles(rack_structure)
            )
        return obstacles

    @staticmethod
    def _build_rack_obstacles(structure: dict) -> list[Obstacle]:
        """Expand the visual rack model into individually collidable parts."""

        template = structure['template']
        length = float(template['length'])
        depth = float(template['depth'])
        height = float(template['height'])
        bays = int(template['bays'])
        bay_width = float(template['bay_width'])
        upright = float(template['upright'])
        upright_inset = float(template['upright_inset'])
        footplate_size = float(template['footplate_size'])
        footplate_height = float(template['footplate_height'])
        beam_levels = [float(value) for value in template['beam_levels']]
        beam_height = float(template['beam_height'])
        guard_offset = float(template['guard_offset'])
        guard_size = [float(value) for value in template['guard_size']]
        brace_size = [float(value) for value in template['brace_size']]
        brace_rotation = float(template['brace_rotation_x'])
        brace_scale = float(template['brace_scale_y'])
        brace_centers = [float(value) for value in template['brace_centers']]

        half_length = length * 0.5
        half_depth = depth * 0.5
        column_y = half_depth - upright_inset
        brace_half_z = (
            brace_scale * 0.5 * math.cos(brace_rotation)
            + brace_size[2] * 0.5 * math.sin(brace_rotation)
        )
        brace_half_y = (
            brace_scale * 0.5 * math.sin(brace_rotation)
            + brace_size[2] * 0.5 * math.cos(brace_rotation)
        )

        obstacles: list[Obstacle] = []
        for row in structure['rows']:
            prefix = str(row['id'])
            row_x = float(row['cx'])
            row_y = float(row['cy'])
            face = float(row['face'])

            for bay in range(bays + 1):
                support_x = row_x - half_length + bay * bay_width
                for side, suffix in ((-1, 'S'), (1, 'N')):
                    support_y = row_y + side * column_y
                    base_id = f'{prefix}-{bay + 1:02d}-{suffix}'
                    obstacles.append(
                        Obstacle(
                            id=f'{base_id}-FOOTPLATE',
                            type='rack_base',
                            cx=support_x,
                            cy=support_y,
                            hx=footplate_size * 0.5,
                            hy=footplate_size * 0.5,
                            yaw=0.0,
                            min_z=0.0,
                            max_z=footplate_height,
                        )
                    )
                    obstacles.append(
                        Obstacle(
                            id=f'{base_id}-SUPPORT',
                            type='rack_support',
                            cx=support_x,
                            cy=support_y,
                            hx=upright * 0.5,
                            hy=upright * 0.5,
                            yaw=0.0,
                            min_z=0.0,
                            max_z=height,
                        )
                    )

            guard_y = row_y - face * guard_offset
            for end, suffix in ((-1, 'W'), (1, 'E')):
                guard_x = row_x + end * (half_length + 0.2)
                obstacles.append(
                    Obstacle(
                        id=f'{prefix}-GUARD-{suffix}',
                        type='rack_guard',
                        cx=guard_x,
                        cy=guard_y,
                        hx=guard_size[0] * 0.5,
                        hy=guard_size[2] * 0.5,
                        yaw=0.0,
                        min_z=0.0,
                        max_z=guard_size[1],
                    )
                )

            for end, suffix in ((-1, 'W'), (1, 'E')):
                brace_x = row_x + end * half_length
                for level_index, center_z in enumerate(brace_centers):
                    obstacles.append(
                        Obstacle(
                            id=f'{prefix}-BRACE-{suffix}-L{level_index + 1}',
                            type='rack_brace',
                            cx=brace_x,
                            cy=row_y,
                            hx=brace_size[0] * 0.5,
                            hy=brace_half_y,
                            yaw=0.0,
                            min_z=center_z - brace_half_z,
                            max_z=center_z + brace_half_z,
                        )
                    )

            for level_index, level in enumerate(beam_levels):
                next_level = (
                    beam_levels[level_index + 1]
                    if level_index + 1 < len(beam_levels)
                    else height + beam_height * 0.5
                )
                obstacles.append(
                    Obstacle(
                        id=f'{prefix}-SHELF-L{level_index + 1}',
                        type='rack_shelf',
                        cx=row_x,
                        cy=row_y,
                        hx=half_length,
                        hy=half_depth,
                        yaw=0.0,
                        min_z=level - beam_height * 0.5,
                        max_z=next_level - beam_height * 0.5,
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
            self.robot_height,
        )

    def _pose_collision(self, x: float, y: float, yaw: float) -> Optional[Obstacle]:
        return find_collision(
            self.obstacles,
            x,
            y,
            yaw,
            self.half_length,
            self.half_width,
            self.robot_height,
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
            self._finish_step(now)
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
            proposed_x, proposed_y, proposed_yaw = integrate_pose(
                self.x, self.y, self.yaw, left_linear * self.dt,
                right_linear * self.dt, self.wheel_separation,
            )
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
                translation_x = self.x + effective_v * math.cos(self.yaw) * self.dt
                translation_y = self.y + effective_v * math.sin(self.yaw) * self.dt
                translation_safe = (
                    abs(effective_v) > 1.0e-5
                    and self._pose_collision(translation_x, translation_y, self.yaw) is None
                )
                rotation_safe = (
                    abs(effective_w) > 1.0e-5
                    and self._pose_collision(self.x, self.y, proposed_yaw) is None
                )

                if translation_safe:
                    self._commit_motion(
                        translation_x, translation_y, self.yaw, effective_v, 0.0
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

        self._finish_step(now)

    def _finish_step(self, now: float) -> None:
        self.wheel_odometry.update(self.left_wheel_angle, self.right_wheel_angle, self.dt)
        self.step_index += 1
        if self.step_index % self.odometry_every == 0:
            self._publish_state(now)
        if self.step_index % self.collision_every == 0:
            self._publish_collision_status(now)

    def _publish_scan(self) -> None:
        message = LaserScan()
        message.header.stamp = self.get_clock().now().to_msg()
        message.header.frame_id = LIDAR_FRAME
        message.angle_min = -math.pi
        message.angle_increment = math.tau / 360
        message.angle_max = message.angle_min + 359 * message.angle_increment
        message.scan_time = 0.1
        # All rays use one authoritative pose, not a rolling acquisition.
        message.time_increment = 0.0
        message.range_min = 0.05
        message.range_max = 30.0
        message.ranges = scan_ranges(self.obstacles, self.x, self.y, self.yaw)
        self.scan_publisher.publish(message)
        low_scan = LaserScan()
        low_scan.header.stamp = message.header.stamp
        low_scan.header.frame_id = 'obstacle_laser_frame'
        low_scan.angle_min, low_scan.angle_max = message.angle_min, message.angle_max
        low_scan.angle_increment, low_scan.scan_time = message.angle_increment, message.scan_time
        low_scan.time_increment = 0.0
        low_scan.range_min, low_scan.range_max = message.range_min, message.range_max
        low_scan.ranges = scan_ranges(self.obstacles, self.x, self.y, self.yaw, height=0.02)
        self.obstacle_scan_publisher.publish(low_scan)

    def _publish_state(self, now: float) -> None:
        stamp = self.get_clock().now().to_msg()
        estimate = self.wheel_odometry
        quaternion = quaternion_from_yaw(estimate.yaw)

        odometry = Odometry()
        odometry.header.stamp = stamp
        odometry.header.frame_id = ODOM_FRAME
        odometry.child_frame_id = BASE_FRAME
        odometry.pose.pose.position.x = estimate.x
        odometry.pose.pose.position.y = estimate.y
        odometry.pose.pose.position.z = 0.0
        odometry.pose.pose.orientation = quaternion
        odometry.pose.covariance = ros_covariance(estimate.covariance)
        odometry.twist.twist.linear.x = estimate.linear_velocity
        odometry.twist.twist.linear.y = 0.0
        odometry.twist.twist.linear.z = 0.0
        odometry.twist.twist.angular.x = 0.0
        odometry.twist.twist.angular.y = 0.0
        odometry.twist.twist.angular.z = estimate.angular_velocity
        odometry.twist.covariance = estimate.twist_covariance
        self.odom_publisher.publish(odometry)

        truth = Odometry()
        truth.header.stamp = stamp
        truth.header.frame_id = WORLD_FRAME
        # This child is diagnostic only; do not give base_link a second TF parent.
        truth.child_frame_id = 'ground_truth_base_link'
        truth.pose.pose.position.x = self.x
        truth.pose.pose.position.y = self.y
        truth.pose.pose.orientation = quaternion_from_yaw(self.yaw)
        truth.twist.twist.linear.x = self.v
        truth.twist.twist.angular.z = self.w
        self.truth_publisher.publish(truth)
        position_error, heading_error = estimate.errors(self.x, self.y, self.yaw)
        status = String()
        status.data = json.dumps({
            'position_error_m': position_error, 'heading_error_rad': heading_error,
            'distance_m': estimate.distance,
            'left_scale': estimate.left_scale, 'right_scale': estimate.right_scale,
            'variance_per_meter': estimate.variance_per_meter,
            'position_std_m': math.sqrt(estimate.covariance[0][0] + estimate.covariance[1][1]),
            'heading_std_rad': math.sqrt(estimate.covariance[2][2]),
            'stamp': now,
        }, allow_nan=False)
        self.odometry_status_publisher.publish(status)

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
        transform.transform.translation.x = estimate.x
        transform.transform.translation.y = estimate.y
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
                    'z_min': round(obstacle.min_z, 4),
                    'z_max': round(obstacle.max_z, 4),
                }
            )
        payload = {
            'frame_id': WORLD_FRAME,
            'robot': {
                'footprint_length': self.footprint_length,
                'footprint_width': self.footprint_width,
                'footprint_padding': self.footprint_padding,
                'height': self.robot_height,
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

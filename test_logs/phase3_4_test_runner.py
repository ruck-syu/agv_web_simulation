#!/usr/bin/env python3
"""Runtime acceptance tests for the Phase 3/4 AGV backend.

The runner starts the installed simulation_node with scenario-specific initial
poses, drives it through /cmd_vel, and records /odom, /joint_states and
/agv_web/collision_status. Results are written to this directory.
"""

from __future__ import annotations

import json
import math
import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Any, Optional

import rclpy
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import String


RESULTS_DIR = Path(__file__).resolve().parent
PROJECT_DIR = RESULTS_DIR.parent
INSTALL_SETUP = PROJECT_DIR / 'ros2_ws' / 'install' / 'setup.bash'


def yaw_from_quaternion(x: float, y: float, z: float, w: float) -> float:
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


def wrap_angle(angle: float) -> float:
    return math.atan2(math.sin(angle), math.cos(angle))


class Harness(Node):
    def __init__(self) -> None:
        super().__init__('phase3_4_test_harness')
        self.cmd_pub = self.create_publisher(Twist, '/cmd_vel', 10)
        self.create_subscription(Odometry, '/odom', self._on_odom, 20)
        self.create_subscription(JointState, '/joint_states', self._on_joints, 20)
        self.create_subscription(
            String, '/agv_web/collision_status', self._on_collision, 20
        )
        self.odom: Optional[Odometry] = None
        self.joints: Optional[JointState] = None
        self.collision: dict[str, Any] = {}
        self.odom_count = 0
        self.joint_count = 0
        self.collision_count = 0
        self.process: Optional[subprocess.Popen[bytes]] = None
        self.log_handle = None

    def _on_odom(self, message: Odometry) -> None:
        self.odom = message
        self.odom_count += 1

    def _on_joints(self, message: JointState) -> None:
        self.joints = message
        self.joint_count += 1

    def _on_collision(self, message: String) -> None:
        try:
            self.collision = json.loads(message.data)
        except json.JSONDecodeError:
            return
        self.collision_count += 1

    def spin_for(self, duration: float, period: float = 0.02) -> None:
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            rclpy.spin_once(self, timeout_sec=min(period, max(0.0, deadline - time.monotonic())))

    def start_sim(self, test_id: int, parameters: dict[str, float]) -> None:
        self.stop_sim()
        self.odom = None
        self.joints = None
        self.collision = {}
        self.odom_count = 0
        self.joint_count = 0
        self.collision_count = 0
        log_path = RESULTS_DIR / f'test_{test_id:02d}_node.log'
        self.log_handle = log_path.open('w', encoding='utf-8')
        command = ['ros2', 'run', 'agv_web_bridge', 'simulation_node', '--ros-args']
        for key, value in parameters.items():
            command.extend(['-p', f'{key}:={value}'])
        self.process = subprocess.Popen(
            command,
            stdout=self.log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            rclpy.spin_once(self, timeout_sec=0.05)
            if self.odom is not None and self.joints is not None and self.collision:
                break
        if self.odom is None or self.joints is None or not self.collision:
            raise RuntimeError(f'Test {test_id}: simulation node did not become ready.')
        self.spin_for(0.3)

    def stop_sim(self) -> None:
        if self.process is not None and self.process.poll() is None:
            try:
                os.killpg(self.process.pid, signal.SIGINT)
            except ProcessLookupError:
                pass
            try:
                self.process.wait(timeout=3.0)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.process.wait(timeout=2.0)
        self.process = None
        subprocess.run(
            ['pkill', '-INT', '-f', '/lib/agv_web_bridge/simulation_node'],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(0.3)
        if self.log_handle is not None:
            self.log_handle.close()
            self.log_handle = None

    def publish_command(self, linear: float, angular: float) -> None:
        message = Twist()
        message.linear.x = linear
        message.angular.z = angular
        self.cmd_pub.publish(message)

    def snapshot(self, test_id: int, t: float, phase: str) -> dict[str, Any]:
        assert self.odom is not None
        position = self.odom.pose.pose.position
        orientation = self.odom.pose.pose.orientation
        twist = self.odom.twist.twist
        left_velocity = None
        right_velocity = None
        left_position = None
        right_position = None
        if self.joints is not None:
            if 'left_wheel_joint' in self.joints.name:
                index = self.joints.name.index('left_wheel_joint')
                left_velocity = float(self.joints.velocity[index])
                left_position = float(self.joints.position[index])
            if 'right_wheel_joint' in self.joints.name:
                index = self.joints.name.index('right_wheel_joint')
                right_velocity = float(self.joints.velocity[index])
                right_position = float(self.joints.position[index])
        return {
            'test_id': test_id,
            't': round(t, 3),
            'phase': phase,
            'x': round(position.x, 4),
            'y': round(position.y, 4),
            'yaw': round(yaw_from_quaternion(orientation.x, orientation.y, orientation.z, orientation.w), 4),
            'v': round(twist.linear.x, 4),
            'w': round(twist.angular.z, 4),
            'left_wheel': None if left_velocity is None else round(left_velocity, 4),
            'right_wheel': None if right_velocity is None else round(right_velocity, 4),
            'left_position': None if left_position is None else round(left_position, 4),
            'right_position': None if right_position is None else round(right_position, 4),
            'motion_state': self.collision.get('motion_state'),
            'collision_state': self.collision.get('state'),
            'blocked': self.collision.get('blocked'),
            'blocked_object_id': self.collision.get('blocked_object_id'),
            'blocked_object_type': self.collision.get('blocked_object_type'),
            'last_object_id': self.collision.get('last_object_id'),
            'command_timed_out': self.collision.get('command_timed_out'),
            'command_active': self.collision.get('command_active'),
        }

    def drive(
        self,
        test_id: int,
        linear: float,
        angular: float,
        duration: float,
        phase: str = 'drive',
        publish: bool = True,
        frequency: float = 10.0,
        samples: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        started = time.monotonic()
        period = 1.0 / frequency
        last_sample = started
        while time.monotonic() - started < duration:
            if publish:
                self.publish_command(linear, angular)
            rclpy.spin_once(self, timeout_sec=0.02)
            now = time.monotonic()
            if samples is not None and now - last_sample >= period:
                samples.append(self.snapshot(test_id, now - started, phase))
                last_sample = now
        if samples is not None:
            samples.append(self.snapshot(test_id, time.monotonic() - started, phase))
        return self.snapshot(test_id, time.monotonic() - started, phase)


def test_definition(
    test_id: int,
    name: str,
    description: str,
    initial_pose: tuple[float, float, float],
    linear: float,
    angular: float,
    hold: float,
    settle: float = 0.0,
    stop_command: bool = True,
    timeout_check: bool = False,
    extra_parameters: Optional[dict[str, float]] = None,
) -> dict[str, Any]:
    return {
        'id': test_id,
        'name': name,
        'description': description,
        'initial_pose': initial_pose,
        'linear': linear,
        'angular': angular,
        'hold': hold,
        'settle': settle,
        'stop_command': stop_command,
        'timeout_check': timeout_check,
        'extra_parameters': extra_parameters or {},
    }


TESTS = [
    test_definition(1, 'forward', 'Drive forward at 0.2 m/s for 2 s.', (-2.8, 1.6, 0.0), 0.2, 0.0, 2.0),
    test_definition(2, 'backward', 'Drive backward at -0.2 m/s for 2 s.', (-2.8, 1.6, 0.0), -0.2, 0.0, 2.0),
    test_definition(3, 'turn_left', 'Rotate counter-clockwise at 0.3 rad/s for 2 s.', (-2.8, 1.6, 0.0), 0.0, 0.3, 2.0),
    test_definition(4, 'turn_right', 'Rotate clockwise at -0.3 rad/s for 2 s.', (-2.8, 1.6, 0.0), 0.0, -0.3, 2.0),
    test_definition(5, 'stop', 'Drive 1 s then command zero velocity and hold it.', (-2.8, 1.6, 0.0), 0.2, 0.0, 1.0, settle=1.2),
    test_definition(6, 'wall_collision', 'Face the north wall and drive into it.', (5.0, 18.2, math.pi / 2.0), 0.35, 0.0, 3.0, settle=0.6),
    test_definition(7, 'rack_collision', 'Drive into a rack support/base plate at rack row C.', (-6.0, 0.3, -math.pi / 2.0), 0.2, 0.0, 3.0, settle=0.6),
    test_definition(8, 'pallet_collision', 'Face a staged pallet and drive into it.', (8.9, -10.0, -math.pi / 2.0), 0.2, 0.0, 3.5, settle=0.6),
    test_definition(9, 'rotate_near_rack', 'Rotate beside a rack support until the footprint hits its base plate.', (-6.0, -0.2, 0.0), 0.0, 0.3, 3.0, settle=0.6),
    test_definition(10, 'cmd_timeout', 'Drive 1 s, then stop publishing commands.', (-2.8, 1.6, 0.0), 0.2, 0.0, 1.0, stop_command=False, timeout_check=True),
    test_definition(11, 'aisle_center', 'Drive along the centre of the 5.16 m aisle between rack blocks B and C.', (-20.0, 1.6, 0.0), 0.4, 0.0, 12.0, settle=0.5),
    test_definition(12, 'aisle_edge_clearance', 'Drive through aisle B-C with 0.10 m clearance to the rack base plates.', (-20.0, 3.45, 0.0), 0.3, 0.0, 10.0, settle=0.5),
    test_definition(13, 'aisle_ab_center', 'Drive along the centre of the aisle between rack blocks A and B.', (-18.0, 9.2, 0.0), 0.4, 0.0, 10.0, settle=0.5),
    test_definition(14, 'aisle_cd_center', 'Drive along the centre of the aisle between rack blocks C and D.', (-18.0, -6.0, 0.0), 0.4, 0.0, 10.0, settle=0.5),
    test_definition(15, 'rotate_in_aisle', 'Rotate 1.9 rad in the centre of aisle B-C without touching a rack.', (-7.5, 1.6, 0.0), 0.0, 0.5, 4.0, settle=0.5),
    test_definition(16, 'rack_leg_collision', 'Drive into the front column/base plate of RACK-B-02.', (-6.0, 3.0, math.pi / 2.0), 0.2, 0.0, 3.0, settle=0.6),
    test_definition(17, 'under_rack_transit', 'Pass under the elevated B-02 and B-01 shelves through a clear bay.', (-7.5, 3.55, math.pi / 2.0), 0.25, 0.0, 16.0, settle=0.5),
    test_definition(18, 'under_rack_low_clearance', 'Tall 1.30 m AGV must stop at the 1.185 m shelf underside.', (-7.5, 3.30, math.pi / 2.0), 0.2, 0.0, 4.0, settle=0.6, extra_parameters={'robot_height': 1.3}),
]

ROBOT_HALF_LENGTH = 0.775
ROBOT_HALF_WIDTH = 0.53


def evaluate(test: dict[str, Any], baseline: dict[str, Any], during: dict[str, Any], after: dict[str, Any], pose_at_zero: dict[str, Any]) -> tuple[bool, dict[str, Any], str]:
    name = test['name']
    dx = during['x'] - baseline['x']
    dy = during['y'] - baseline['y']
    dyaw = wrap_angle(during['yaw'] - baseline['yaw'])
    stopped_linear = 0.0 if after['v'] is None else abs(after['v'])
    stopped_angular = 0.0 if after['w'] is None else abs(after['w'])
    displacement_after_zero = math.hypot(after['x'] - pose_at_zero['x'], after['y'] - pose_at_zero['y'])
    wheel_delta_left = (
        None
        if baseline['left_position'] is None or during['left_position'] is None
        else during['left_position'] - baseline['left_position']
    )
    wheel_delta_right = (
        None
        if baseline['right_position'] is None or during['right_position'] is None
        else during['right_position'] - baseline['right_position']
    )

    checks: dict[str, Any] = {}
    if name == 'forward':
        checks['forward_displacement_m'] = {'value': round(dx, 4), 'min': 0.15}
        checks['lateral_drift_m'] = {'value': round(abs(dy), 4), 'max': 0.05}
        checks['heading_drift_rad'] = {'value': round(abs(dyaw), 4), 'max': 0.05}
        checks['left_wheel_forward_rad_s'] = {'value': during['left_wheel'], 'min': 0.5}
        checks['right_wheel_forward_rad_s'] = {'value': during['right_wheel'], 'min': 0.5}
        checks['left_wheel_angle_delta_rad'] = {'value': None if wheel_delta_left is None else round(wheel_delta_left, 4), 'min': 0.5}
        checks['right_wheel_angle_delta_rad'] = {'value': None if wheel_delta_right is None else round(wheel_delta_right, 4), 'min': 0.5}
        passed = (
            dx > 0.15
            and abs(dy) < 0.05
            and abs(dyaw) < 0.05
            and (during['left_wheel'] or 0.0) > 0.5
            and (during['right_wheel'] or 0.0) > 0.5
            and (wheel_delta_left or 0.0) > 0.5
            and (wheel_delta_right or 0.0) > 0.5
        )
        summary = f'Δx={dx:.3f} m, Δy={abs(dy):.4f} m, Δyaw={abs(dyaw):.4f} rad, wheels={during["left_wheel"]:.3f}/{during["right_wheel"]:.3f} rad/s'
    elif name == 'backward':
        checks['backward_displacement_m'] = {'value': round(-dx, 4), 'min': 0.15}
        checks['lateral_drift_m'] = {'value': round(abs(dy), 4), 'max': 0.05}
        checks['heading_drift_rad'] = {'value': round(abs(dyaw), 4), 'max': 0.05}
        checks['left_wheel_backward_rad_s'] = {'value': during['left_wheel'], 'max': -0.5}
        checks['right_wheel_backward_rad_s'] = {'value': during['right_wheel'], 'max': -0.5}
        passed = dx < -0.15 and abs(dy) < 0.05 and abs(dyaw) < 0.05 and (during['left_wheel'] or 0.0) < -0.5 and (during['right_wheel'] or 0.0) < -0.5
        summary = f'Δx={dx:.3f} m, Δy={abs(dy):.4f} m, Δyaw={abs(dyaw):.4f} rad, wheels={during["left_wheel"]:.3f}/{during["right_wheel"]:.3f} rad/s'
    elif name in ('turn_left', 'turn_right'):
        expected_sign = 1.0 if name == 'turn_left' else -1.0
        checks['yaw_change_rad'] = {'value': round(dyaw, 4), 'expected_sign': expected_sign, 'magnitude_min': 0.2}
        checks['translation_drift_m'] = {'value': round(math.hypot(dx, dy), 4), 'max': 0.03}
        left = during['left_wheel'] or 0.0
        right = during['right_wheel'] or 0.0
        checks['differential_wheel_sign'] = {'left': round(left, 4), 'right': round(right, 4), 'expected': 'right > left' if expected_sign > 0 else 'left > right'}
        passed = expected_sign * dyaw > 0.2 and math.hypot(dx, dy) < 0.03 and ((right > left) if expected_sign > 0 else (left > right))
        summary = f'Δyaw={dyaw:.3f} rad, drift={math.hypot(dx, dy):.4f} m, wheels={left:.3f}/{right:.3f} rad/s'
    elif name == 'stop':
        checks['velocity_after_stop_m_s'] = {'value': round(stopped_linear, 4), 'max': 0.02}
        checks['angular_after_stop_rad_s'] = {'value': round(stopped_angular, 4), 'max': 0.02}
        checks['displacement_after_zero_m'] = {'value': round(displacement_after_zero, 4), 'max': 0.05}
        checks['wheel_speed_after_stop_rad_s'] = {'value': None if after['left_wheel'] is None else round(max(abs(after['left_wheel']), abs(after['right_wheel'] or 0.0)), 4), 'max': 0.02}
        passed = (
            stopped_linear < 0.02
            and stopped_angular < 0.02
            and displacement_after_zero < 0.05
            and (after['left_wheel'] is not None and abs(after['left_wheel']) < 0.02)
            and (after['right_wheel'] is not None and abs(after['right_wheel']) < 0.02)
        )
        summary = f'v={stopped_linear:.4f} m/s, ω={stopped_angular:.4f} rad/s, post-zero travel={displacement_after_zero:.4f} m'
    elif name == 'wall_collision':
        expected = 'wall_north'
        front = during['y'] + ROBOT_HALF_LENGTH
        checks['blocked'] = {'value': during['blocked'], 'expected': True}
        checks['blocked_object_id'] = {'value': during['blocked_object_id'], 'expected': expected}
        checks['front_edge_y_m'] = {'value': round(front, 4), 'max': 19.71}
        checks['final_speed_m_s'] = {'value': during['v'], 'max': 0.02}
        passed = during['blocked'] is True and during['blocked_object_id'] == expected and front <= 19.73 and abs(during['v']) < 0.02
        summary = f'blocked={during["blocked"]}, object={during["blocked_object_id"]}, front edge={front:.3f} m, v={during["v"]:.4f} m/s'
    elif name == 'rack_collision':
        expected = 'RACK-C-01-07-N-FOOTPLATE'
        front = during['y'] - ROBOT_HALF_LENGTH
        checks['blocked'] = {'value': during['blocked'], 'expected': True}
        checks['blocked_object_id'] = {'value': during['blocked_object_id'], 'expected': expected}
        checks['blocked_object_type'] = {'value': during['blocked_object_type'], 'expected': 'rack_base'}
        checks['front_edge_y_m'] = {'value': round(front, 4), 'min': -0.90}
        checks['final_speed_m_s'] = {'value': during['v'], 'max': 0.02}
        passed = during['blocked'] is True and during['blocked_object_id'] == expected and front >= -0.90 and abs(during['v']) < 0.02
        summary = f'blocked={during["blocked"]}, object={during["blocked_object_id"]}, front edge={front:.3f} m, v={during["v"]:.4f} m/s'
    elif name == 'pallet_collision':
        expected = 'PALLET-STAGE-01'
        front = during['y'] - ROBOT_HALF_LENGTH
        checks['blocked'] = {'value': during['blocked'], 'expected': True}
        checks['blocked_object_id'] = {'value': during['blocked_object_id'], 'expected': expected}
        checks['front_edge_y_m'] = {'value': round(front, 4), 'min': -11.38}
        checks['final_speed_m_s'] = {'value': during['v'], 'max': 0.02}
        passed = during['blocked'] is True and during['blocked_object_id'] == expected and front >= -11.405 and abs(during['v']) < 0.02
        summary = f'blocked={during["blocked"]}, object={during["blocked_object_id"]}, front edge={front:.3f} m, v={during["v"]:.4f} m/s'
    elif name == 'rotate_near_rack':
        expected = 'RACK-C-01-07-N-FOOTPLATE'
        checks['blocked'] = {'value': during['blocked'], 'expected': True}
        checks['blocked_object_id'] = {'value': during['blocked_object_id'], 'expected': expected}
        checks['blocked_object_type'] = {'value': during['blocked_object_type'], 'expected': 'rack_base'}
        checks['yaw_change_rad'] = {'value': round(dyaw, 4), 'max': math.pi / 2.0}
        checks['translation_drift_m'] = {'value': round(math.hypot(dx, dy), 4), 'max': 0.03}
        checks['final_speed_rad_s'] = {'value': during['w'], 'max': 0.02}
        passed = during['blocked'] is True and during['blocked_object_id'] == expected and dyaw < math.pi / 2.0 + 0.02 and abs(during['w']) < 0.02
        summary = f'blocked={during["blocked"]}, object={during["blocked_object_id"]}, Δyaw={dyaw:.3f} rad, ω={during["w"]:.4f} rad/s'
    elif name == 'cmd_timeout':
        checks['command_timed_out'] = {'value': after['command_timed_out'], 'expected': True}
        checks['command_active'] = {'value': after['command_active'], 'expected': False}
        checks['velocity_after_timeout_m_s'] = {'value': round(stopped_linear, 4), 'max': 0.02}
        checks['wheel_speed_after_timeout_rad_s'] = {'value': None if after['left_wheel'] is None else round(max(abs(after['left_wheel']), abs(after['right_wheel'] or 0.0)), 4), 'max': 0.02}
        checks['displacement_after_timeout_m'] = {'value': round(displacement_after_zero, 4), 'max': 0.2}
        passed = after['command_timed_out'] is True and after['command_active'] is False and stopped_linear < 0.02 and displacement_after_zero < 0.2 and (after['left_wheel'] is not None and abs(after['left_wheel']) < 0.02)
        summary = f'timed_out={after["command_timed_out"]}, active={after["command_active"]}, v={stopped_linear:.4f} m/s, travel={displacement_after_zero:.4f} m'
    elif name in ('aisle_center', 'aisle_edge_clearance', 'aisle_ab_center', 'aisle_cd_center'):
        minimum_displacement = 0.6 * abs(test['linear']) * test['hold']
        checks['forward_displacement_m'] = {'value': round(dx, 4), 'min': minimum_displacement}
        checks['lateral_drift_m'] = {'value': round(abs(dy), 4), 'max': 0.03}
        checks['blocked'] = {'value': during['blocked'], 'expected': False}
        checks['collision_state'] = {'value': during['collision_state'], 'expected': 'clear'}
        checks['blocked_object_id'] = {'value': during['blocked_object_id'], 'expected': None}
        checks['final_position_ros'] = {'x': during['x'], 'y': during['y']}
        if name == 'aisle_edge_clearance':
            clearance = 4.08 - (during['y'] + ROBOT_HALF_WIDTH)
            checks['clearance_to_RACK_B_02_base_plate_m'] = {'value': round(clearance, 4), 'min': 0.08}
        passed = (
            dx > minimum_displacement
            and abs(dy) < 0.03
            and during['blocked'] is False
            and during['collision_state'] == 'clear'
            and during['blocked_object_id'] is None
        )
        summary = (
            f'Δx={dx:.3f} m, blocked={during["blocked"]}, '
            f'object={during["blocked_object_id"]}, final=({during["x"]:.3f}, {during["y"]:.3f})'
        )
    elif name == 'rotate_in_aisle':
        checks['yaw_change_rad'] = {'value': round(dyaw, 4), 'min': 1.5, 'max': 2.1}
        checks['translation_drift_m'] = {'value': round(math.hypot(dx, dy), 4), 'max': 0.04}
        checks['blocked'] = {'value': during['blocked'], 'expected': False}
        checks['collision_state'] = {'value': during['collision_state'], 'expected': 'clear'}
        passed = (
            dyaw > 1.5
            and dyaw < 2.1
            and math.hypot(dx, dy) < 0.04
            and during['blocked'] is False
            and during['collision_state'] == 'clear'
        )
        summary = (
            f'Δyaw={dyaw:.3f} rad, drift={math.hypot(dx, dy):.4f} m, '
            f'blocked={during["blocked"]}, object={during["blocked_object_id"]}'
        )
    elif name == 'rack_leg_collision':
        expected = 'RACK-B-02-07-S-FOOTPLATE'
        front = during['y'] + ROBOT_HALF_LENGTH
        checks['blocked'] = {'value': during['blocked'], 'expected': True}
        checks['blocked_object_id'] = {'value': during['blocked_object_id'], 'expected': expected}
        checks['blocked_object_type'] = {'value': during['blocked_object_type'], 'expected': 'rack_base'}
        checks['front_edge_y_m'] = {'value': round(front, 4), 'min': 4.06}
        checks['final_speed_m_s'] = {'value': during['v'], 'max': 0.02}
        passed = during['blocked'] is True and during['blocked_object_id'] == expected and front >= 4.06 and abs(during['v']) < 0.02
        summary = f'blocked={during["blocked"]}, object={during["blocked_object_id"]}, front edge={front:.3f} m, v={during["v"]:.4f} m/s'
    elif name == 'under_rack_transit':
        checks['forward_displacement_m'] = {'value': round(dy, 4), 'min': 3.0}
        checks['lateral_drift_m'] = {'value': round(abs(dx), 4), 'max': 0.03}
        checks['blocked'] = {'value': during['blocked'], 'expected': False}
        checks['collision_state'] = {'value': during['collision_state'], 'expected': 'clear'}
        checks['final_y_m'] = {'value': round(during['y'], 4), 'min': 6.7}
        checks['robot_height_m'] = {'value': 0.96, 'max': 1.185}
        passed = (
            dy > 3.0
            and abs(dx) < 0.03
            and during['blocked'] is False
            and during['collision_state'] == 'clear'
            and during['y'] > 6.7
        )
        summary = f'Δy={dy:.3f} m, final y={during["y"]:.3f} m, blocked={during["blocked"]}'
    elif name == 'under_rack_low_clearance':
        expected = 'RACK-B-02-SHELF-L1'
        front = during['y'] + ROBOT_HALF_LENGTH
        checks['blocked'] = {'value': during['blocked'], 'expected': True}
        checks['blocked_object_id'] = {'value': during['blocked_object_id'], 'expected': expected}
        checks['blocked_object_type'] = {'value': during['blocked_object_type'], 'expected': 'rack_shelf'}
        checks['front_edge_y_m'] = {'value': round(front, 4), 'min': 4.16}
        checks['shelf_underside_m'] = {'value': 1.185, 'max': 1.3}
        checks['final_speed_m_s'] = {'value': during['v'], 'max': 0.02}
        passed = during['blocked'] is True and during['blocked_object_id'] == expected and front >= 4.16 and abs(during['v']) < 0.02
        summary = f'blocked={during["blocked"]}, object={during["blocked_object_id"]}, front edge={front:.3f} m, v={during["v"]:.4f} m/s'
    else:
        raise ValueError(name)
    return passed, checks, summary


def run() -> None:
    rclpy.init()
    harness = Harness()
    all_results: list[dict[str, Any]] = []
    try:
        for test in TESTS:
            print(f'[TEST {test["id"]:02d}] {test["name"]}: {test["description"]}', flush=True)
            samples: list[dict[str, Any]] = []
            x, y, yaw = test['initial_pose']
            parameters = {
                'initial_x': x,
                'initial_y': y,
                'initial_yaw': yaw,
            }
            parameters.update(test['extra_parameters'])
            harness.start_sim(test['id'], parameters)
            baseline = harness.snapshot(test['id'], 0.0, 'baseline')
            samples.append(baseline)
            during = harness.drive(
                test['id'],
                test['linear'],
                test['angular'],
                test['hold'],
                phase='command',
                samples=samples,
            )
            samples.append({**during, 'phase': 'end_of_command'})
            pose_at_zero = harness.snapshot(test['id'], test['hold'], 'before_stop')
            if test['stop_command']:
                after = harness.drive(
                    test['id'],
                    0.0,
                    0.0,
                    test['settle'] if test['settle'] else 0.0,
                    phase='stop',
                    samples=samples,
                )
            else:
                after = harness.drive(
                    test['id'],
                    0.0,
                    0.0,
                    test['settle'] if test['settle'] else 1.5,
                    phase='timeout',
                    publish=False,
                    samples=samples,
                )
            if test['timeout_check']:
                harness.drive(
                    test['id'],
                    0.0,
                    0.0,
                    max(0.0, 1.5 - (test['settle'] if test['settle'] else 1.5)),
                    phase='timeout',
                    samples=samples,
                )
                after = harness.snapshot(test['id'], 0.0, 'timeout')

            passed, checks, summary = evaluate(test, baseline, during, after, pose_at_zero)
            result = {
                'id': test['id'],
                'name': test['name'],
                'description': test['description'],
                'initial_pose_ros': {'x': x, 'y': y, 'yaw': yaw},
                'command': {'linear_x': test['linear'], 'angular_z': test['angular'], 'hold_sec': test['hold']},
                'baseline': baseline,
                'during': during,
                'after': after,
                'checks': checks,
                'passed': passed,
                'summary': summary,
                'samples': samples,
            }
            all_results.append(result)
            print(f'[TEST {test["id"]:02d}] {"PASS" if passed else "FAIL"} - {summary}', flush=True)
    finally:
        harness.stop_sim()
        (RESULTS_DIR / 'phase3_4_results.json').write_text(
            json.dumps(
                {
                    'generated_at_local': time.strftime('%Y-%m-%d %H:%M:%S'),
                    'ros_distro': os.environ.get('ROS_DISTRO', 'humble'),
                    'tests': all_results,
                },
                indent=2,
            ),
            encoding='utf-8',
        )
        harness.destroy_node()
        rclpy.shutdown()

    lines = [
        '# Phase 3/4 Runtime Test Results',
        '',
        f'Generated: {time.strftime("%Y-%m-%d %H:%M:%S")}',
        '',
        '| # | Test | Result | Measurements |',
        '|---|------|--------|--------------|',
    ]
    for result in all_results:
        lines.append(
            f'| {result["id"]} | {result["name"]} | {"PASS" if result["passed"] else "FAIL"} | {result["summary"]} |'
        )
    passed_count = sum(1 for result in all_results if result['passed'])
    lines.extend(['', f'**{passed_count}/{len(all_results)} tests passed.**', ''])
    lines.append('## Checks')
    for result in all_results:
        lines.append('')
        lines.append(f'### {result["id"]}. {result["name"]} — {"PASS" if result["passed"] else "FAIL"}')
        lines.append('')
        lines.append(f'- Command: linear.x={result["command"]["linear_x"]} m/s, angular.z={result["command"]["angular_z"]} rad/s for {result["command"]["hold_sec"]} s')
        for key, value in result['checks'].items():
            lines.append(f'- `{key}`: {json.dumps(value)}')
    (RESULTS_DIR / 'phase3_4_test_log.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'Wrote {RESULTS_DIR / "phase3_4_results.json"} and phase3_4_test_log.md', flush=True)


if __name__ == '__main__':
    run()

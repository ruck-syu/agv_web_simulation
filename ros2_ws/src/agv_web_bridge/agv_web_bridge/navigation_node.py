"""Browser command bridge, Nav2 action lifecycle and exclusive velocity selection."""
import json
import math
import time
import rclpy
from rclpy.node import Node
from rclpy.action import ActionClient
from rclpy.qos import QoSProfile, DurabilityPolicy
from tf2_msgs.msg import TFMessage
from action_msgs.msg import GoalStatus
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry, OccupancyGrid
from lifecycle_msgs.srv import GetState
from lifecycle_msgs.msg import State
from nav2_msgs.action import NavigateToPose
from sensor_msgs.msg import LaserScan
from std_msgs.msg import String
from .control import CommandArbiter, valid_goal


class NavigationNode(Node):
    def __init__(self):
        super().__init__('agv_navigation_bridge')
        self.control = CommandArbiter()
        self.map_time = self.map_tf_time = -math.inf
        self.client = ActionClient(self, NavigateToPose, 'navigate_to_pose')
        self.lifecycle = {}
        self.lifecycle_pending = set()
        self.lifecycle_clients = {name: self.create_client(GetState, f'/{name}/get_state')
            for name in ('controller_server', 'planner_server', 'smoother_server', 'behavior_server', 'bt_navigator')}
        self.create_timer(1.0, self._lifecycle_check)
        self.output = self.create_publisher(Twist, '/cmd_vel', 10)
        self.status_output = self.create_publisher(String, '/agv_web/navigation_status', 10)
        self.state, self.detail = 'idle', 'Manual control ready'
        self.goal = None
        self.goal_handle = None
        self.pending = False
        self.revision = 0
        self.distance_remaining = None
        self.create_subscription(Twist, '/agv_web/manual_cmd_vel', self._manual, 10)
        self.create_subscription(Twist, '/agv_web/nav_cmd_vel', self._navigation, 10)
        self.create_subscription(String, '/agv_web/navigation_command', self._command, 10)
        self.create_subscription(String, '/agv_web/operator_heartbeat', self._heartbeat, 10)
        self.create_subscription(Odometry, '/odom', lambda _: setattr(self.control, 'odom_time', time.monotonic()), 10)
        self.create_subscription(LaserScan, '/scan_obstacles', lambda _: setattr(self.control, 'scan_time', time.monotonic()), 10)
        self.create_subscription(OccupancyGrid, '/map', self._map, QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL))
        self.create_subscription(TFMessage, '/tf', self._tf, 10)
        self.create_timer(0.05, self._tick)
        self.create_timer(0.2, self._status)

    def _lifecycle_check(self):
        for name, client in self.lifecycle_clients.items():
            if not client.service_is_ready():
                self.lifecycle[name] = False
                continue
            if name in self.lifecycle_pending:
                continue
            self.lifecycle_pending.add(name)
            client.call_async(GetState.Request()).add_done_callback(lambda future, name=name: self._lifecycle_result(name, future))

    def _lifecycle_result(self, name, future):
        self.lifecycle_pending.discard(name)
        try:
            self.lifecycle[name] = future.result().current_state.id == State.PRIMARY_STATE_ACTIVE
        except Exception:
            self.lifecycle[name] = False

    def _stack_ready(self):
        return self.client.server_is_ready() and all(self.lifecycle.get(name, False) for name in self.lifecycle_clients)

    def _map(self, message):
        if message.header.frame_id == 'map' and message.info.width > 0 and message.info.height > 0 and message.info.resolution > 0:
            self.map_time = time.monotonic()

    def _tf(self, message):
        if any(t.header.frame_id == 'map' and t.child_frame_id == 'odom' for t in message.transforms):
            self.map_tf_time = time.monotonic()

    def _localization_ready(self, now):
        return 0 <= now - self.map_time < 30.0 and 0 <= now - self.map_tf_time < 1.5

    def _heartbeat(self, message):
        if message.data == 'alive':
            self.control.heartbeat_time = time.monotonic()

    def _manual(self, message):
        if not all(math.isfinite(v) for v in (message.linear.x, message.angular.z)):
            return
        if self.control.mode == 'autonomous' or self.pending:
            self._cancel('Manual control took priority')
        self.control.receive_manual(message.linear.x, message.angular.z, time.monotonic())

    def _navigation(self, message):
        self.control.receive_navigation(message.linear.x, message.angular.z, time.monotonic())

    def _command(self, message):
        try:
            payload = json.loads(message.data)
        except (ValueError, TypeError):
            return
        if not isinstance(payload, dict):
            return
        if payload.get('action') in ('cancel', 'stop'):
            self._cancel('Stopped by operator')
            return
        goal = valid_goal(payload)
        if goal is None:
            self.detail = 'Rejected invalid goal; provide finite map x, y and yaw'
            return
        if self.pending or self.goal_handle is not None:
            self.detail = 'A goal is active; cancel it before sending another'
            return
        now = time.monotonic()
        if not self._stack_ready() or not self._localization_ready(now) or not self.control.sensors_ready(now) or not self.control.operator_ready(now):
            self.state, self.detail = 'unavailable', 'Active Nav2, fresh SLAM localization, sensors and operator heartbeat are required'
            return
        self.revision += 1
        revision = self.revision
        self.goal = goal
        self.pending = True
        self.control.stop()
        self.distance_remaining = None
        self.state, self.detail = 'sending', 'Sending map goal to Nav2'
        message = NavigateToPose.Goal()
        message.pose.header.frame_id = 'map'
        message.pose.header.stamp = self.get_clock().now().to_msg()
        message.pose.pose.position.x, message.pose.pose.position.y = goal[:2]
        message.pose.pose.orientation.z = math.sin(goal[2] / 2)
        message.pose.pose.orientation.w = math.cos(goal[2] / 2)
        self.client.send_goal_async(message, feedback_callback=lambda feedback: self._feedback(feedback, revision)).add_done_callback(
            lambda future: self._accepted(future, revision))

    def _accepted(self, future, revision):
        try:
            handle = future.result()
        except Exception as error:
            self.pending = False
            if revision == self.revision:
                self.control.stop()
                self.state, self.detail = 'failed', str(error)
            return
        if revision != self.revision:
            self.pending = False
            if handle.accepted:
                self.goal_handle = handle
                handle.cancel_goal_async()
                handle.get_result_async().add_done_callback(lambda result: self._result(result, revision))
            return
        self.pending = False
        if not handle.accepted:
            self.control.stop()
            self.state, self.detail = 'failed', 'Nav2 rejected this goal'
            return
        self.goal_handle = handle
        self.control.start()
        self.state, self.detail = 'navigating', 'Nav2 is following the planned path'
        handle.get_result_async().add_done_callback(lambda result: self._result(result, revision))

    def _feedback(self, message, revision):
        if revision == self.revision:
            value = float(message.feedback.distance_remaining)
            self.distance_remaining = value if math.isfinite(value) else None

    def _result(self, future, revision):
        if revision != self.revision:
            self.goal_handle = None
            return
        self.goal_handle = None
        self.control.stop()
        try:
            status = future.result().status
            self.state = ('succeeded' if status == GoalStatus.STATUS_SUCCEEDED else
                          'canceled' if status == GoalStatus.STATUS_CANCELED else 'failed')
            self.detail = {'succeeded': 'Goal reached', 'canceled': 'Goal canceled', 'failed': 'Navigation did not reach the goal'}[self.state]
        except Exception as error:
            self.state, self.detail = 'failed', str(error)

    def _cancel(self, reason):
        self.revision += 1
        self.control.stop()
        if self.goal_handle is not None:
            self.goal_handle.cancel_goal_async()
        self.distance_remaining = None
        self.state, self.detail = 'canceled', reason
        self.output.publish(Twist())

    def _tick(self):
        now = time.monotonic()
        if (self.control.mode == 'autonomous' or self.pending) and (not self._stack_ready() or not self._localization_ready(now) or not self.control.sensors_ready(now) or not self.control.operator_ready(now)):
            self._cancel('Localization, sensor stream or operator heartbeat expired')
        linear, angular = self.control.command(now)
        message = Twist()
        message.linear.x, message.angular.z = linear, angular
        self.output.publish(message)

    def _status(self):
        now = time.monotonic()
        message = String()
        message.data = json.dumps({'state': self.state, 'detail': self.detail,
            'mode': self.control.mode, 'busy': self.pending or self.goal_handle is not None, 'server_ready': self._stack_ready(),
            'localization_ready': self._localization_ready(now), 'sensors_ready': self.control.sensors_ready(now), 'operator_ready': self.control.operator_ready(now),
            'distance_remaining': self.distance_remaining,
            'goal': list(self.goal) if self.goal else None}, allow_nan=False)
        self.status_output.publish(message)


def main(args=None):
    rclpy.init(args=args)
    node = NavigationNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.output.publish(Twist())
        node.destroy_node()
        rclpy.shutdown()

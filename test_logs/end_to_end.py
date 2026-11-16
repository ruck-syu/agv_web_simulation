"""Acceptance client for a separately launched full stack, in the same ROS domain."""
import json
import math
import time
from pathlib import Path
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from sensor_msgs.msg import LaserScan
from nav_msgs.msg import Odometry, OccupancyGrid, Path as RosPath
from std_msgs.msg import String
from tf2_msgs.msg import TFMessage
from rclpy.qos import QoSProfile, DurabilityPolicy


class Acceptance(Node):
    def __init__(self):
        super().__init__('agv_full_stack_acceptance')
        self.status = {}; self.odom = None; self.truth = None; self.map = None; self.map_tf = None
        self.path_seen = False; self.collision_seen = False
        self.counts = {'scan': 0, 'scan_obstacles': 0, 'odom': 0, 'map': 0}
        self.heartbeat_enabled = True
        self.heartbeat = self.create_publisher(String, '/agv_web/operator_heartbeat', 10)
        self.command = self.create_publisher(String, '/agv_web/navigation_command', 10)
        self.manual = self.create_publisher(Twist, '/agv_web/manual_cmd_vel', 10)
        self.create_timer(0.25, self.beat)
        self.create_subscription(String, '/agv_web/navigation_status', self.on_status, 10)
        self.create_subscription(String, '/agv_web/collision_status', self.on_collision, 10)
        self.create_subscription(Odometry, '/odom', self.on_odom, 10)
        self.create_subscription(Odometry, '/agv_web/ground_truth', lambda m: setattr(self, 'truth', m), 10)
        self.create_subscription(OccupancyGrid, '/map', self.on_map, QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL))
        self.create_subscription(TFMessage, '/tf', self.on_tf, 10)
        self.create_subscription(RosPath, '/plan', self.on_path, 10)
        for topic in ('scan', 'scan_obstacles'):
            self.create_subscription(LaserScan, '/' + topic, lambda m, key=topic: self.on_scan(m, key), 5)

    def beat(self):
        if self.heartbeat_enabled:
            message = String(); message.data = 'alive'; self.heartbeat.publish(message)

    def on_status(self, message): self.status = json.loads(message.data)
    def on_collision(self, message): self.collision_seen |= json.loads(message.data).get('collision', False)
    def on_odom(self, message): self.odom = message; self.counts['odom'] += 1
    def on_map(self, message): self.map = message; self.counts['map'] += 1
    def on_scan(self, message, key):
        assert len(message.ranges) == 360
        self.counts[key] += 1
    def on_tf(self, message):
        for transform in message.transforms:
            if transform.header.frame_id == 'map' and transform.child_frame_id == 'odom': self.map_tf = transform
    def on_path(self, message): self.path_seen |= len(message.poses) > 0

    def wait(self, predicate, timeout, description):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            rclpy.spin_once(self, timeout_sec=0.05)
            if predicate(): return
        raise AssertionError(f'{description}: timed out; status={self.status}, topics={self.counts}')

    def spin_for(self, duration):
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline: rclpy.spin_once(self, timeout_sec=0.02)

    def map_pose(self):
        orientation = self.odom.pose.pose.orientation
        yaw = 2 * math.atan2(orientation.z, orientation.w)
        transform = self.map_tf.transform
        angle = 2 * math.atan2(transform.rotation.z, transform.rotation.w)
        x, y = self.odom.pose.pose.position.x, self.odom.pose.pose.position.y
        return (transform.translation.x + math.cos(angle) * x - math.sin(angle) * y,
                transform.translation.y + math.sin(angle) * x + math.cos(angle) * y, angle + yaw)

    def goal_forward(self, distance):
        x, y, yaw = self.map_pose()
        payload = {'action': 'goal', 'x': x + distance * math.cos(yaw), 'y': y + distance * math.sin(yaw), 'yaw': yaw}
        message = String(); message.data = json.dumps(payload); self.command.publish(message)
        return payload


def main():
    rclpy.init()
    node = Acceptance()
    report = {'passed': False}
    started = time.monotonic()
    try:
        node.wait(lambda: node.map is not None and node.map_tf is not None and node.odom is not None and
            node.status.get('server_ready') and node.status.get('localization_ready') and node.status.get('sensors_ready') and node.status.get('operator_ready'), 45, 'Full stack readiness')
        assert any(value == 0 for value in node.map.data), 'SLAM must observe free cells'
        assert any(value > 50 for value in node.map.data), 'SLAM must observe occupied cells'
        counts = dict(node.counts); rate_start = time.monotonic(); node.spin_for(3)
        elapsed = time.monotonic() - rate_start
        report['rates_hz'] = {key: (node.counts[key] - counts[key]) / elapsed for key in ('scan', 'scan_obstacles', 'odom')}
        assert report['rates_hz']['scan'] >= 7 and report['rates_hz']['odom'] >= 18, report
        before = (node.truth.pose.pose.position.x, node.truth.pose.pose.position.y)
        report['goal'] = node.goal_forward(1.2)
        node.wait(lambda: node.status.get('state') in ('sending', 'navigating'), 5, 'Goal acceptance')
        node.wait(lambda: node.status.get('state') in ('succeeded', 'failed'), 60, 'Goal completion')
        assert node.status['state'] == 'succeeded', node.status
        assert node.path_seen, 'Planner must publish an actual path'
        assert math.hypot(node.truth.pose.pose.position.x - before[0], node.truth.pose.pose.position.y - before[1]) > 0.7, 'Physical robot must move to the goal'
        reached = node.map_pose()
        assert math.hypot(reached[0] - report['goal']['x'], reached[1] - report['goal']['y']) < 0.3, 'Robot must reach requested map location'
        report['successful_goal'] = dict(node.status)
        node.goal_forward(1.0)
        node.wait(lambda: node.status.get('state') in ('sending', 'navigating'), 5, 'Second goal acceptance')
        cancel = String(); cancel.data = '{"action":"cancel"}'; node.command.publish(cancel)
        node.wait(lambda: node.status.get('state') == 'canceled' and not node.status.get('busy'), 10, 'Cancellation completion')
        node.spin_for(0.7)
        assert abs(node.odom.twist.twist.linear.x) < 0.01
        assert abs(node.odom.twist.twist.angular.z) < 0.01
        report['cancel'] = 'pass'
        node.goal_forward(1.0)
        node.wait(lambda: node.status.get('state') == 'navigating', 5, 'Third goal acceptance')
        node.heartbeat_enabled = False
        node.wait(lambda: node.status.get('state') == 'canceled' and 'heartbeat' in node.status.get('detail', ''), 5, 'Heartbeat expiry stop')
        node.spin_for(1.0)
        assert abs(node.odom.twist.twist.linear.x) < 0.01
        assert abs(node.odom.twist.twist.angular.z) < 0.01
        assert not node.collision_seen, 'Robot must not enter collision geometry'
        report['heartbeat_stop'] = 'pass'
        report['passed'] = True
    finally:
        cancel = String(); cancel.data = '{"action":"cancel"}'; node.command.publish(cancel)
        report['elapsed_seconds'] = time.monotonic() - started
        report['topics_received'] = node.counts
        Path('/workspace/test_logs/end_to_end_results.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2), flush=True)
        node.destroy_node(); rclpy.shutdown()

if __name__ == '__main__': main()

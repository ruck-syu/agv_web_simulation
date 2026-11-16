"""Real bidirectional ROS 2 string communication test for the web dashboard."""

from __future__ import annotations

import rclpy
from rclpy.node import Node
from std_msgs.msg import String


TOPIC_FROM_ROS = '/agv_web/test'
TOPIC_FROM_WEB = '/agv_web/from_web'
TOPIC_ACK = '/agv_web/ack'


class CommTestNode(Node):
    """Emit real heartbeats and acknowledge every browser publish on ROS."""

    def __init__(self) -> None:
        super().__init__('agv_web_comm_test')

        self.declare_parameter('heartbeat_period_sec', 2.0)
        self.declare_parameter('ack_prefix', 'agv_web_bridge ACK')

        period = float(self.get_parameter('heartbeat_period_sec').value)
        if period < 0.2:
            self.get_logger().warning(
                f'heartbeat_period_sec={period} is too small; using 0.2 seconds.'
            )
            period = 0.2

        self._ack_prefix = str(self.get_parameter('ack_prefix').value)
        self._heartbeat_sequence = 0
        self._ack_sequence = 0

        self._heartbeat_publisher = self.create_publisher(String, TOPIC_FROM_ROS, 10)
        self._ack_publisher = self.create_publisher(String, TOPIC_ACK, 10)
        self._command_subscription = self.create_subscription(
            String, TOPIC_FROM_WEB, self._handle_web_message, 10
        )
        self._heartbeat_timer = self.create_timer(period, self._publish_heartbeat)

        self.get_logger().info(
            f'agv_web_bridge ready: publishing {TOPIC_FROM_ROS}, subscribing {TOPIC_FROM_WEB}, '
            f'publishing acknowledgements on {TOPIC_ACK}.'
        )
        self._publish_heartbeat()

    def _stamp_text(self) -> str:
        stamp = self.get_clock().now().to_msg()
        return f'{stamp.sec}.{stamp.nanosec:09d}'

    def _publish_heartbeat(self) -> None:
        self._heartbeat_sequence += 1
        message = String()
        message.data = (
            f'ROS 2 HUMBLE HEARTBEAT #{self._heartbeat_sequence} '
            f'| node=agv_web_comm_test | ros_time={self._stamp_text()}'
        )
        self._heartbeat_publisher.publish(message)

    def _handle_web_message(self, message: String) -> None:
        payload = message.data.strip()
        self._ack_sequence += 1
        stamp = self._stamp_text()

        if payload:
            self.get_logger().info(
                f'Browser message #{self._ack_sequence} received on {TOPIC_FROM_WEB}: {payload}'
            )
            ack_payload = (
                f'{self._ack_prefix} #{self._ack_sequence} '
                f'| received_at={stamp} | payload={payload}'
            )
        else:
            self.get_logger().warning('Empty browser payload received; returning an error ACK.')
            ack_payload = (
                f'{self._ack_prefix} #{self._ack_sequence} '
                f'| received_at={stamp} | error=empty payload'
            )

        acknowledgement = String()
        acknowledgement.data = ack_payload
        self._ack_publisher.publish(acknowledgement)


def main(args: list[str] | None = None) -> None:
    rclpy.init(args=args)
    node = CommTestNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()

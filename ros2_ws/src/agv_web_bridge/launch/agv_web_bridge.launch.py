"""Launch rosbridge and the real bidirectional communication test node."""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import FrontendLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description() -> LaunchDescription:
    rosbridge_share = get_package_share_directory('rosbridge_server')
    rosbridge_launch = os.path.join(rosbridge_share, 'launch', 'rosbridge_websocket_launch.xml')

    port = LaunchConfiguration('port')
    heartbeat_period = LaunchConfiguration('heartbeat_period')
    ack_prefix = LaunchConfiguration('ack_prefix')

    return LaunchDescription(
        [
            DeclareLaunchArgument(
                'port',
                default_value='9090',
                description='WebSocket port used by rosbridge.',
            ),
            DeclareLaunchArgument(
                'heartbeat_period',
                default_value='2.0',
                description='Heartbeat interval in seconds for /agv_web/test.',
            ),
            DeclareLaunchArgument(
                'ack_prefix',
                default_value='agv_web_bridge ACK',
                description='Prefix included in acknowledgements on /agv_web/ack.',
            ),
            IncludeLaunchDescription(
                FrontendLaunchDescriptionSource(rosbridge_launch),
                launch_arguments={'port': port}.items(),
            ),
            Node(
                package='agv_web_bridge',
                executable='comm_test_node',
                name='agv_web_comm_test',
                output='screen',
                parameters=[
                    {
                        'heartbeat_period_sec': ParameterValue(heartbeat_period, value_type=float),
                        'ack_prefix': ParameterValue(ack_prefix, value_type=str),
                    }
                ],
            ),
        ]
    )

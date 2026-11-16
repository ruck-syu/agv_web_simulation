"""Launch rosbridge and the authoritative AGV simulation node."""

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
    initial_x = LaunchConfiguration('initial_x')
    initial_y = LaunchConfiguration('initial_y')
    initial_yaw = LaunchConfiguration('initial_yaw')
    simulation_rate = LaunchConfiguration('simulation_rate')
    cmd_vel_timeout = LaunchConfiguration('cmd_vel_timeout')

    return LaunchDescription(
        [
            DeclareLaunchArgument('odom_left_scale', default_value='1.0'),
            DeclareLaunchArgument('odom_right_scale', default_value='1.0'),
            DeclareLaunchArgument('odom_variance_per_meter', default_value='0.0001'),
            DeclareLaunchArgument('port', default_value='9090'),
            DeclareLaunchArgument('initial_x', default_value='-2.8'),
            DeclareLaunchArgument('initial_y', default_value='1.6'),
            DeclareLaunchArgument('initial_yaw', default_value='0.0'),
            DeclareLaunchArgument('simulation_rate', default_value='50.0'),
            DeclareLaunchArgument('cmd_vel_timeout', default_value='0.5'),
            IncludeLaunchDescription(
                FrontendLaunchDescriptionSource(rosbridge_launch),
                launch_arguments={'port': port}.items(),
            ),
            Node(package='agv_web_bridge', executable='navigation_node', output='screen'),
            Node(
                package='agv_web_bridge',
                executable='simulation_node',
                name='agv_web_simulation',
                output='screen',
                parameters=[
                    {
                        'odom_left_scale': ParameterValue(LaunchConfiguration('odom_left_scale'), value_type=float),
                        'odom_right_scale': ParameterValue(LaunchConfiguration('odom_right_scale'), value_type=float),
                        'odom_variance_per_meter': ParameterValue(LaunchConfiguration('odom_variance_per_meter'), value_type=float),
                        'initial_x': ParameterValue(initial_x, value_type=float),
                        'initial_y': ParameterValue(initial_y, value_type=float),
                        'initial_yaw': ParameterValue(initial_yaw, value_type=float),
                        'simulation_rate': ParameterValue(simulation_rate, value_type=float),
                        'cmd_vel_timeout': ParameterValue(cmd_vel_timeout, value_type=float),
                    }
                ],
            ),
        ]
    )

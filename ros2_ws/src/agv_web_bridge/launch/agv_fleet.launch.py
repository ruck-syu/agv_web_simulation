"""Two-AGV equivalent navigation, fleet coordination and one rosbridge."""
import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import FrontendLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from agv_web_bridge.fleet import AUTONOMOUS_CRUISE_SPEED


def generate_launch_description():
    bridge=os.path.join(get_package_share_directory("rosbridge_server"),"launch","rosbridge_websocket_launch.xml")
    return LaunchDescription([
        DeclareLaunchArgument("autonomous_cruise_speed", default_value=str(AUTONOMOUS_CRUISE_SPEED)),
        IncludeLaunchDescription(FrontendLaunchDescriptionSource(bridge),launch_arguments={"port":"9090"}.items()),
        Node(package="agv_web_bridge",executable="fleet_simulation",output="screen"),
        Node(package="agv_web_bridge", executable="fleet_node", output="screen", parameters=[{
            "autonomous_cruise_speed": ParameterValue(LaunchConfiguration("autonomous_cruise_speed"), value_type=float),
        }]),
    ])

"""Two-AGV equivalent navigation, fleet coordination and one rosbridge."""
import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription
from launch.launch_description_sources import FrontendLaunchDescriptionSource
from launch_ros.actions import Node


def generate_launch_description():
    bridge=os.path.join(get_package_share_directory("rosbridge_server"),"launch","rosbridge_websocket_launch.xml")
    return LaunchDescription([
        IncludeLaunchDescription(FrontendLaunchDescriptionSource(bridge),launch_arguments={"port":"9090"}.items()),
        Node(package="agv_web_bridge",executable="fleet_simulation",output="screen"),
        Node(package="agv_web_bridge",executable="fleet_node",output="screen"),
    ])

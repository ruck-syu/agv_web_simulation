"""Simulation and real online SLAM, continuing a compatible saved map on startup."""
import json
from pathlib import Path
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, OpaqueFunction, LogInfo
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from agv_web_bridge.map_cache import cached_parameters


def generate_launch_description():
    share = Path(get_package_share_directory('agv_web_bridge'))
    config = json.loads((share / 'config/warehouse_collision.json').read_text())
    def start_slam(context):
        cache = LaunchConfiguration('map_cache').perform(context)
        initial = [float(LaunchConfiguration(name).perform(context)) for name in ('initial_x', 'initial_y', 'initial_yaw')]
        try:
            saved = cached_parameters(cache, config, initial)
            detail = f'Restoring SLAM map: {saved["map_file_name"]}' if saved else 'No saved SLAM map. Explore aisles, then run ros2 run agv_web_bridge save_map.'
        except (ValueError, OSError, TypeError) as error:
            saved = {}; detail = f'Saved SLAM map not loaded: {error}'
        return [LogInfo(msg=detail), Node(package='slam_toolbox', executable='async_slam_toolbox_node',
            name='slam_toolbox', output='screen', parameters=[str(share / 'config/slam.yaml'), saved, {'use_sim_time': False}])]
    return LaunchDescription([
        DeclareLaunchArgument('map_cache', default_value=str(Path.cwd() / 'maps/warehouse.json')),
        IncludeLaunchDescription(PythonLaunchDescriptionSource(str(share / 'launch/agv_simulation.launch.py'))),
        OpaqueFunction(function=start_slam),
    ])

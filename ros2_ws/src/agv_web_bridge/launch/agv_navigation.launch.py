"""Full simulator, SLAM, Nav2 lifecycle and browser action/velocity bridge."""
from pathlib import Path
import yaml
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.actions import Node
from agv_web_bridge.configuration import merge, wall_clock


def generate_launch_description():
    share = Path(get_package_share_directory('agv_web_bridge'))
    nav2 = Path(get_package_share_directory('nav2_bringup'))
    with (nav2 / 'params/nav2_params.yaml').open() as source:
        defaults = yaml.safe_load(source)
    with (share / 'config/navigation.yaml').open() as source:
        params = wall_clock(merge(defaults, yaml.safe_load(source)))
    servers = [('controller_server', 'nav2_controller'), ('planner_server', 'nav2_planner'),
               ('smoother_server', 'nav2_smoother'), ('behavior_server', 'nav2_behaviors'),
               ('bt_navigator', 'nav2_bt_navigator')]
    # Launch uses a generated parameter file so nested costmap names are preserved.
    # The path lives in a temporary directory, never in the read-only package share.
    import tempfile
    from launch.actions import OpaqueFunction, RegisterEventHandler
    from launch.event_handlers import OnShutdown
    import os
    descriptor, filename = tempfile.mkstemp(prefix='agv-nav2-', suffix='.yaml')
    with os.fdopen(descriptor, 'w') as output:
        yaml.safe_dump(params, output)
    # Create every server from the same complete ROS parameter file.
    nodes = [Node(package=package, executable=name, name=name, output='screen',
        parameters=[filename], remappings=[('cmd_vel', '/agv_web/nav_cmd_vel')])
        for name, package in servers]
    def cleanup(context):
        Path(filename).unlink(missing_ok=True)
        return []
    return LaunchDescription([
        IncludeLaunchDescription(PythonLaunchDescriptionSource(str(share / 'launch/agv_mapping.launch.py'))),
        *nodes,
        Node(package='nav2_lifecycle_manager', executable='lifecycle_manager', name='lifecycle_manager_navigation',
            output='screen', parameters=[{'use_sim_time': False, 'autostart': True,
                'node_names': [name for name, _ in servers]}]),
        RegisterEventHandler(OnShutdown(on_shutdown=[OpaqueFunction(function=cleanup)])),
    ])

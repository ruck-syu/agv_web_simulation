# Phase 7 — SLAM and mapping

Validated with real SLAM Toolbox and map/TF streams in Docker Humble. See [FINAL_VALIDATION.md](history/FINAL_VALIDATION.md) (historical single-robot report).

`agv_mapping.launch.py` launches the authoritative simulation, rosbridge and SLAM Toolbox online asynchronous mapping with the installed `config/slam.yaml`. Real laser scans and wheel TF are the only SLAM inputs. SLAM publishes `/map` and `map → odom`; the simulator publishes `odom → base_link → laser_frame`. All nodes use wall clock (`use_sim_time=false`); this simulator does not publish `/clock`.

The dashboard renders the occupancy grid with its resolution and origin, preserves unknown space, and composes `map → odom` with the estimated robot pose for a map marker. It never substitutes physical warehouse truth for SLAM localization. Occupancy rows are flipped for display only. The display is in grid-local coordinates, so inverse origin yaw is applied consistently to markers. Maps expire from the live display after 30 seconds without an update. Maps over one million cells are rejected to bound frontend memory.

Install ROS Humble `slam_toolbox`, rebuild `agv_web_bridge`, and launch `ros2 launch agv_web_bridge agv_mapping.launch.py`. Do not launch a second simulator or AMCL at the same time. Drive a closed loop through aisles. Verify `/map` gains observed free/occupied cells and `ros2 run tf2_ros tf2_echo map base_link` works. Save with `ros2 run nav2_map_server map_saver_cli -f warehouse_map` if Nav2 map tools are installed. Retain the resulting PGM/YAML together; no map is fabricated from known warehouse geometry.

Sources: [SLAM Toolbox Humble launch](https://github.com/SteveMacenski/slam_toolbox/blob/humble/launch/online_async_launch.py), [SLAM parameter reference](https://github.com/SteveMacenski/slam_toolbox/blob/humble/config/mapper_params_online_async.yaml).

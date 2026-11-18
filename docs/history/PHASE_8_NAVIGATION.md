**Historical report — superseded by docs/MULTI_AGV.md and docs/FLEET_ROLLING_VALIDATION.md**

# Phase 8 — Nav2 navigation and obstacle avoidance

Validated with real Nav2 goal arrival, cancellation and heartbeat stopping in Docker Humble, plus goal submission/cancel in Chrome. See [FINAL_VALIDATION.md](FINAL_VALIDATION.md).

Launch `ros2 launch agv_web_bridge agv_navigation.launch.py` for simulation, rosbridge, SLAM Toolbox, Nav2 servers, lifecycle management and the browser action bridge. No external `/clock` is required. Warehouse overrides merge into the installed Humble Nav2 defaults, retaining its BT plugins. All servers share the generated parameter file so nested costmap node parameters are applied; the temporary file is removed on launch shutdown.

The planner is Smac Hybrid A* with SE(2) footprint collision checking and a 0.6 m turning radius. DWB evaluates the rectangular 1.55 × 1.06 m footprint, with 3 cm costmap padding, against local obstacles. Speeds/accelerations stay within simulator limits. Global planning disallows unknown space: explore manually first. SLAM map and costmaps drive planning; physical collision blocking remains the final movement constraint.

A second planar obstacle scanner at 0.02 m (`/scan_obstacles`, frame `obstacle_laser_frame`) detects pallets and floor guards below the roof LiDAR plane. Both scans feed costmap obstacle layers; only roof `/scan` feeds SLAM. Sensor observations are simulated from the existing geometric approximations, not mesh triangles.

## Command ownership

- Browser manual input: `/agv_web/manual_cmd_vel` (Twist).
- Nav2 controller/recovery input: `/agv_web/nav_cmd_vel` (Twist).
- The navigation bridge selects one source and owns `/cmd_vel`, consumed by the simulator. Do not run other publishers on this output.
- Manual input cancels the Nav2 goal and takes priority. Expired manual/Nav2 commands yield zero after 0.3 seconds.
- Browser `/agv_web/operator_heartbeat` expires after 2 seconds; stale map/localization TF, odometry or obstacle scans expire after 1.5 seconds. Either cancels autonomy and sends zero. A background/hidden browser tab stops heartbeat, so autonomous motion requires a visible operator session.
- Simulator acceleration limiting, geometric collision blocking and its own command timeout remain active.

The dashboard submits finite x/y/yaw map goals through `/agv_web/navigation_command` (String JSON `{action: "goal", x, y, yaw}`); `{action: "cancel"}` or `{action: "stop"}` cancels. The bridge uses a real `nav2_msgs/action/NavigateToPose` client, tracks acceptance/feedback/result, prevents overlapping goals, and cancels late acceptance of an already-canceled request. New goals wait for prior actions to terminate. `/agv_web/navigation_status` reports readiness, state, ownership, remaining distance and errors. No completion is inferred from frontend animation.

The map panel overlays the global `/plan`. Goal coordinates are in `map`, which may differ from warehouse/world coordinates after SLAM localization correction. The physical 3D model continues to use ground truth.

## Acceptance

After exploring free space, enter a map goal in a known free aisle. Verify the planned path, decreasing action feedback distance, successful arrival and stopped wheels. Test a goal inside occupied/unknown space: it must fail or reject without fabricating arrival. Test cancel during goal submission and execution, manual takeover, bridge disconnect, hidden tab, stale scanner/odometry, and command timeout. Verify low pallets contribute to the costmap and the physical robot never penetrates obstacles.

References: [Nav2 Humble bringup](https://github.com/ros-navigation/navigation2/tree/humble/nav2_bringup), [Smac planner](https://github.com/ros-navigation/navigation2/tree/humble/nav2_smac_planner), [ROS action client lifecycle](https://github.com/ros2/ros2_documentation/blob/humble/source/Tutorials/Intermediate/Writing-an-Action-Server-Client/Py.rst).

Readiness also requires each Nav2 lifecycle node to report active and both a recent `/map` and `map → odom` transform. Missing/stale localization rejects goals and stops active autonomy. DWB uses a 0.1 m local goal tolerance inside the 0.2 m goal-checker tolerance to avoid stopping just outside the action success threshold.

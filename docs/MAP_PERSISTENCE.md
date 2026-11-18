# Map persistence and restart verification

> Evidence paths shown as `test_logs/...` are generated locally by the acceptance runs. `test_logs/` is gitignored, so those files are not tracked in Git.

## Why navigation stopped

On 2026-11-17, Docker and ROS were running, localization and sensor streams were fresh, and the collision state was clear. However, SLAM had restarted without the explored map. The observed map had 16,629 free cells and 131,536 unknown cells; Nav2 repeatedly exhausted its planner search trying to reach D1 through aisles that were not connected by observed free space. The geometric preview could still draw a warehouse route, which did not establish that the live SLAM planner knew that route.

## Repair

- Explored all five open rack aisles using guarded manual commands and live scans. No artificial free-space map was installed and the solid rack footprints remain blocked.
- Added `ros2 run agv_web_bridge save_map` to checkpoint a real SLAM pose graph and its warehouse-to-map alignment while the robot is stopped.
- Checkpoints use uniquely named graph/data pairs. The JSON manifest is replaced only after successful serialization and validation, preserving the previous checkpoint if saving fails.
- Startup restores the graph at the actual configured spawn pose, transformed into the saved map frame. The cache is used only when its warehouse-geometry fingerprint matches, both files exist and are nonempty, and metadata is valid. Missing/invalid/incompatible checkpoints are reported in startup logs and start fresh mapping.
- Improved failed-navigation feedback to point operators toward mapped, clear aisle connectivity.

The local checkpoint is `maps/warehouse.json` with its referenced `.posegraph` and `.data` files. The host workspace mount keeps these through Docker restarts. Generated map files are ignored by Git; a fresh checkout without them must explore and save its own real map. This is an explicit checkpoint, not a shutdown autosave: save again after further exploration or layout changes.

SLAM startup uses `map_file_name` and `map_start_pose`, documented in the [official SLAM Toolbox configuration](https://github.com/SteveMacenski/slam_toolbox/blob/ros2/config/mapper_params_online_async.yaml).

## Validation

All **53 backend tests** passed, including seven checkpoint tests for restoration, geometry mismatch, missing/empty graph files, malformed transforms and safe snapshot paths. The save CLI also refused an attempt while the robot was moving; it succeeded after the robot was stopped.

Recreated the ROS container from the updated Docker image. Logs confirmed both `Restoring SLAM map` and `Load From File` for the saved snapshot. No mapping drive was performed after this restart. Then ran the native rack-navigation acceptance from the reset spawn to B2, followed by D1.

| Post-restart check | Observed result |
|---|---|
| B2 physical arrival error | 0.087 m |
| D1 physical arrival error | 0.054 m |
| Live Nav2 plans | 74 |
| Planned AGV footprints checked against rack volumes | 5696 |
| Physical trajectory samples checked | 1893 |
| Rack intrusion or collision blocking | None |
| Outcome | PASS |

The route used the west cross aisle, reaching world X -25.485 m beyond the rack ends. Unknown-space restrictions, footprint dimensions, collision prevention and operator/sensor watchdogs were retained.

Evidence: `test_logs/map_persistence/restart.log`, `test_logs/map_persistence/live-result.json`, `test_logs/map_persistence/checkpoint.json`, `test_logs/map_persistence/mapping-drive.json`, `test_logs/map_persistence/backend-tests.log`.

## Save or update the map

Stop the robot, then from the repository root:

```bash
rtk proxy docker compose exec -T simulation bash -c 'source /opt/ros/humble/setup.bash && source /opt/agv_ws/install/setup.bash && ros2 run agv_web_bridge save_map'
```

A custom checkpoint location can be selected with `save_map --output /path/warehouse.json` and the launch argument `map_cache:=/path/warehouse.json`. Spawn coordinates are taken from the simulation's `initial_x`, `initial_y` and `initial_yaw` arguments.

This verifies the reported B2 → D1 failure after an actual container restart. It does not certify every possible rack pairing or dynamically changed warehouse. The local frontend and Docker services remain running; the acceptance client stopped the robot and exited at the destination.

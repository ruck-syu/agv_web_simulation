# Phase 5 — LiDAR implementation and validation gate

**Final integration update:** Live ROS validation now runs in the Docker Humble environment on this Mac. See [FINAL_VALIDATION.md](history/FINAL_VALIDATION.md) for historical passing results; pending/skipped notes below describe the earlier host-only checks.

**Phase 6 update:** `/odom` now contains a wheel estimate. Physical visualization uses `/agv_web/ground_truth` in `world`. See [Phase 6](PHASE_6_ODOMETRY.md) for the current topic/frame contract; references below to ground-truth `/odom` describe the original Phase 5 implementation.

Implemented in source. Live ROS and browser validation remains pending; Phases 6–9 are not marked complete.

The existing Phase 3/4 report records 15 passing runtime scenarios on the previous Linux/WSL environment. Those results are historical and have not been rerun on this Mac.

## Sensor contract

- `/scan`: `sensor_msgs/msg/LaserScan`, reliable queue depth 5 for rosbridge compatibility; normal best-effort sensor subscribers can also connect.
- 360 rays at 10 Hz, counterclockwise from −π, with no duplicate endpoint; range 0.05–30 m.
- `laser_frame`: fixed roof mount at `(0, 0, 1.02)` relative to `base_link`, broadcast on `/tf_static`. The existing `odom → base_link` transform remains authoritative.
- Box intersections respect obstacle rotation; circular obstacles use analytic intersections. Only shapes crossing the 1.02 m scan plane contribute. Existing geometry approximations (including rack shelf volumes) are retained; individual visual cartons are not separately sensed.
- Nearest surface wins. Beyond range/no hit is positive infinity, below minimum range is negative infinity. Intensity is empty. There is no simulated noise or rolling scan distortion.
- Header timestamp is taken for the authoritative pose used for the whole scan. `time_increment=0` describes instantaneous acquisition; `scan_time=0.1` describes the interval between scans.

The frontend accepts only `laser_frame` scans, rejects invalid metadata and excludes non-finite JSON encodings and out-of-range measurements from plotting. It shows a robot-relative SVG plot and textual range diagnostics. Warehouse points use the most recently received fresh odometry pose at scan receipt; this is an approximate display transform, not timestamp-synchronized TF localization. Points remain attached to that captured pose and disappear when disconnected or stale (1.5 seconds). No stale odometry pose is used when its age exceeds 300 ms. The display assumes the fixed sensor mount above and is not a general TF viewer.

Message conventions follow the [ROS 2 Humble LaserScan definition](https://github.com/ros2/common_interfaces/blob/humble/sensor_msgs/msg/LaserScan.msg).

## Checks performed here

```bash
rtk proxy python3 -m unittest discover -s ros2_ws/src/agv_web_bridge/test -v
cd frontend
rtk proxy node --test tests/lidar.test.mjs
rtk npm run build
```

Eight deterministic geometry tests and three parser tests pass. The ROS runtime acceptance test skips explicitly because this macOS machine has no `rclpy` or `/opt/ros` installation. Do not interpret a skip as a live acceptance pass.

## Live acceptance on the ROS 2 Humble machine

Stop any existing simulation instance before running the acceptance test, so topics are not interleaved with a second robot. Rebuild from source rather than using the previously copied install directory:

```bash
source /opt/ros/humble/setup.bash
cd ros2_ws
colcon build --packages-select agv_web_bridge --symlink-install
source install/setup.bash
cd ..
python3 -m unittest discover -s ros2_ws/src/agv_web_bridge/test -v
python3 test_logs/phase3_4_test_runner.py
ros2 launch agv_web_bridge agv_simulation.launch.py
```

> Legacy single-robot procedure: `test_logs/phase3_4_test_runner.py` is no longer tracked. For the current two-AGV fleet, use `scripts/fleet_concurrency_smoke.py` and `agv_fleet.launch.py` instead (see [MULTI_AGV.md](MULTI_AGV.md)).

In a second sourced shell:

```bash
ros2 topic hz /scan
ros2 topic echo /scan --once
ros2 run tf2_ros tf2_echo base_link laser_frame
```

Run the frontend with `npm run dev`, connect to rosbridge, and verify: scans arrive near 10 Hz; cyan returns align with warehouse geometry; moving/turning updates returns; the toggle hides points; disconnecting removes the scan and points; collision blocking and command timeout still work. The runtime test covers topic publication, scan metadata, late-subscriber static TF, continued scanning during motion, and timeout stopping.

## Remaining sequence

1. **Phase 5 acceptance:** run the live checks above and resolve discrepancies before proceeding.
2. **Phase 6:** implemented wheel-integrated odometry, separate ground truth, configurable encoder scale error, propagated covariance and drift diagnostics. Local checks pass; live ROS/browser acceptance remains pending. See `PHASE_6_ODOMETRY.md`.
3. **Phase 7:** configure `slam_toolbox` against validated `/scan`, `/odom` and TF, verify `map → odom` and occupancy grid publication while driving a loop.
4. **Phase 8:** configure Nav2 footprint, costmaps, planner/controller and lifecycle; add goals/cancel; validate aisle navigation and obstacle stops with command arbitration.
5. **Phase 9:** integrate map/path/goal states and sensor health in the dashboard; run end-to-end and performance acceptance.

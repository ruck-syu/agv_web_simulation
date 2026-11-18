# Phase 6 — Wheel odometry and localization estimate

**Final integration update:** Live ROS validation now runs in the Docker Humble environment on this Mac. See [FINAL_VALIDATION.md](history/FINAL_VALIDATION.md) for historical passing results; pending/skipped notes below describe the earlier host-only checks.

Implemented in source; live ROS 2 and browser acceptance are pending. Phase 5 live acceptance is also still pending. SLAM, absolute localization and Nav2 remain for Phases 7–8.

## Behavior

`/odom` now estimates robot pose from cumulative accepted wheel-angle increments, wheel radius and wheel separation. It no longer copies simulator coordinates. The estimator runs at each 50 Hz physics step, including stopped/blocked steps, and publishes at the configured odometry cadence (25 Hz by default). Constant-curvature integration handles straight motion, reverse, pure rotation, arcs and angle wrap. The physical simulator also uses exact arc integration so ideal wheel encoders agree with ground truth up to floating-point error.

When collision handling accepts only translation or rotation, only that accepted component contributes wheel travel. Rejected movement and stationary wheels produce no encoder drift. Command timeout retains acceleration-limited stopping. The translation-only fallback follows the current heading rather than a rejected turn's intermediate heading.

The estimate starts at the simulator's initial pose, so the initial odometry and warehouse coordinate axes/origins are numerically aligned. It remains continuous and can drift thereafter. Restarting the simulation resets both pose and encoder history; no running reset service or localization correction is introduced.

## Topics and frames

| Interface | Meaning |
| --- | --- |
| `/odom` (`nav_msgs/msg/Odometry`) | Wheel estimate; header `odom`, child `base_link`; pose covariance and body-frame twist |
| `/tf`: `odom → base_link` | Same estimate, quaternion and exact timestamp as `/odom` |
| `/tf_static`: `base_link → laser_frame` | Existing fixed LiDAR mount |
| `/agv_web/ground_truth` (`nav_msgs/msg/Odometry`) | Physical warehouse pose; header `world`, child `ground_truth_base_link`; same timestamp as `/odom` |
| `/agv_web/odometry_status` (`std_msgs/msg/String`, JSON) | Synchronized position/heading errors, encoder distance, wheel scales, uncertainty and step timestamp |
| `/joint_states` | Accepted physical wheel angles and velocities, in radians and radians/sec |
| `/agv_web/collision_geometry` | Fixed warehouse geometry, now explicitly labeled `world` |

Ground truth is diagnostic data, not an extra TF parent for `base_link`. No `world → odom`, `map → odom`, or ground-truth TF is published. A future localization/SLAM node will own `map → odom`. Do not connect a second odometry TF broadcaster concurrently.

The warehouse robot model, camera follow, drive freshness gate, collision overlay and world-space LiDAR display now consume ground truth. A separate Wheel odometry panel consumes the estimate and synchronized backend error diagnostics. This prevents encoder bias from visually driving the physical robot through a rack. The LiDAR overlay still uses a fresh pose captured at receipt rather than timestamp-interpolated TF. Disconnecting clears pose/estimate/diagnostics; stale estimate and diagnostic values are hidden independently.

Message frames follow the [ROS 2 Humble Odometry definition](https://github.com/ros2/common_interfaces/blob/humble/nav_msgs/msg/Odometry.msg): pose belongs to the header frame, while twist belongs to the child frame.

## Error model and uncertainty

| ROS parameter / launch argument | Default | Meaning |
| --- | --- | --- |
| `odom_left_scale` | `1.0` | Left encoder distance conversion multiplier |
| `odom_right_scale` | `1.0` | Right encoder distance conversion multiplier |
| `odom_variance_per_meter` | `0.0001` | Independent wheel distance variance per metre traveled, in m²/m |

Scales must be finite and positive; variance must be finite and nonnegative. They are startup settings, not dynamically reconfigured values. Changing encoder scale affects only the estimate, not wheel commands, collision decisions, LiDAR ray casting, or physical motion.

Equal scale errors cause distance error; unequal scales cause heading error and lateral drift. This is a deterministic calibration-error experiment. It can illustrate apparent excess encoder travel relative to true travel, but does not implement stochastic physical tire slip or alter traction physics. No random sensor noise is injected.

Pose covariance propagates with the exact motion Jacobians using `P_next = F P Fᵀ + G Q Gᵀ`, with wheel variance proportional to absolute wheel distance. Initial x/y variance is 0.002 m² and yaw variance is 0.004 rad². Cross terms are preserved when mapped into the ROS 6×6 covariance. Body-frame twist covariance is derived from wheel variance and timestep. Unobserved z/roll/pitch and lateral twist use large variance (1e6), and linear/angular twist have small numerical floors. Covariance describes this assumed independent wheel-noise model; it does not bound unmodeled systematic calibration bias. There is no absolute sensor correction yet.

Error is measured against ground truth in the same backend state: Euclidean position error in metres and wrapped signed heading error in radians. Encoder distance sums the absolute center travel and is zero for a pure in-place turn. Heading uncertainty is yaw standard deviation; position uncertainty is `sqrt(Pxx + Pyy)`, not a confidence ellipse radius.

## Validation on this machine

```bash
rtk proxy python3 -m unittest discover -s ros2_ws/src/agv_web_bridge/test -v
rtk proxy python3 -m compileall -q ros2_ws/src/agv_web_bridge/agv_web_bridge ros2_ws/src/agv_web_bridge/launch ros2_ws/src/agv_web_bridge/test
cd frontend
rtk proxy node --test tests/lidar.test.mjs tests/odometry.test.mjs
rtk npm run build
```

- 22 Python unit tests pass: 8 LiDAR and 14 odometry checks.
- 7 frontend parser tests pass: 3 LiDAR and 4 odometry/telemetry checks.
- TypeScript checking and the production build pass.
- 4 ROS acceptance tests skip explicitly because this Mac has no `rclpy`: the Phase 5 sensor test and 3 Phase 6 binding scenarios. A skip is not a live validation pass. No browser acceptance was performed here.

Odometry tests use known straight-line, reverse, quarter-circle and full-circle results; fixed calibration drift; stopping/blocked encoder behavior; wrapped angles; covariance symmetry and nonnegative quadratic forms; finite-difference validation of motion Jacobians; ROS covariance indexing; and invalid-input rejection. Frontend checks ensure ground truth and estimated frames cannot be mixed, invalid poses are rejected, quaternions are normalized, and malformed drift data is ignored.

## ROS 2 Humble acceptance

Stop existing simulation instances first. Source Humble and rebuild the package so old copied build/install files cannot mask these changes:

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

Phase 6 runtime tests advance fixed physics steps while a ROS harness receives actual messages. They check zero-bias agreement, deliberately biased drift, collision blocking, timeout stopping, covariance, and exact `/odom`/TF/ground-truth stamp agreement. The separate Phase 5 test exercises real timers and scans during motion.

In a second sourced terminal:

```bash
ros2 topic hz /odom
ros2 topic echo /agv_web/ground_truth --once
ros2 topic echo /agv_web/odometry_status --once
ros2 run tf2_ros tf2_echo odom base_link
ros2 run tf2_ros tf2_echo base_link laser_frame
```

Connect the dashboard and drive straight, reverse and rotate. With scale defaults, position/heading errors should stay near zero. Stop the launch, then restart with a bias experiment:

```bash
ros2 launch agv_web_bridge agv_simulation.launch.py odom_left_scale:=0.98 odom_right_scale:=1.02
```

Drive along an aisle: the estimated heading should diverge while the physical robot and collision geometry remain aligned. Stop, wait for timeout, and verify both physical and estimated velocities settle to zero and error stops growing. Disconnect/reconnect rosbridge and verify stale readings disappear and fresh truth/estimate streams recover.

## Next phase

Complete live Phase 5/6 acceptance before SLAM integration. Phase 7 will use `/scan` and the drifting `odom → base_link` estimate to build an occupancy grid and supply `map → odom`; simulator truth must not be fed into SLAM as a localization correction.

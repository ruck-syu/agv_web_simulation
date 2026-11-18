**Historical report — superseded by docs/MULTI_AGV.md and docs/FLEET_ROLLING_VALIDATION.md**

> Evidence paths shown as `test_logs/...` are generated locally by the acceptance runs. `test_logs/` is gitignored, so those files are not tracked in Git.

# Final integration validation — Phases 1–9

Date: 2026-11-15. All project phases are implemented and integrated. Four Luna subagents reviewed Phases 6, 7, 8 and 9; findings and fixes are recorded in [CODE_REVIEWS.md](CODE_REVIEWS.md).

The Mac host does not have a native ROS installation. Docker Desktop was started, and an actual Linux ARM64 ROS 2 Humble environment was built locally. Validation below uses real ROS publishers, TF, SLAM Toolbox and Nav2, not mocks or prerecorded topic data. The complete stack is reproducible with `docker compose up -d --build`.

## Passing checks

| Check | Result | Evidence |
| --- | --- | --- |
| Backend unit and ROS binding suite | **39/39 pass, no skips** | `test_logs/phase5_9_tests.log` |
| Motion/collision acceptance | **18/18 pass** | `test_logs/phase3_4_results.json`, `test_logs/phase3_4_test_log.md` |
| Frontend parser tests | **12/12 pass** | `cd frontend && npm test` |
| Production TypeScript/Vite build | **Pass** | `cd frontend && npm run build` |
| Real SLAM/Nav2 end-to-end client | **Pass** | `test_logs/end_to_end_results.json` |
| Headless Chrome dashboard end-to-end | **1/1 pass** | `test_logs/browser_results.json` |
| Compose configuration and Python syntax | **Pass** | `docker compose config --quiet`, Python `compileall` |

The backend suite covers wheel integration, calibrated drift, covariance/Jacobians, scalar/vectorized sensor equivalence, sensor TF, exact odom/TF stamp agreement, collision/timeout behavior, actual navigation-node startup, late action acceptance/cancel/result races, and stale localization gating. Separate ROS domains isolate acceptance drivers from the operator stack.

The motion/collision scenarios include forward/reverse/rotation, stopping, command timeout, wall/rack/pallet blocking, rotation near a rack, aisle centers and edge clearance, under-rack travel and low-clearance blocking. These are newly rerun results, replacing reliance on earlier copied install files.

The end-to-end client receives real roof/floor scans, odometry, occupancy maps and map localization; sends a 1.2 m goal to the actual Nav2 action server; observes a real global path, physical movement and successful arrival within 0.3 m of the requested map coordinate; cancels another goal; and confirms heartbeat expiry stops both translation and rotation. It records collision contact and fails if the robot penetrates warehouse geometry. Final run completed in 12.51 seconds.

Chrome acceptance verifies live LiDAR/odometry/map/Nav2 readiness, all ten health checks, LiDAR visibility toggling, real goal submission and cancellation, disconnect clearing, reconnect recovery, and absence of uncaught browser errors. Software WebGL warm-up contributes to the roughly 50 second test duration; it is not a measurement of hardware-accelerated rendering performance.

## Performance evidence

- Roof scan: **9.92 Hz**; obstacle scan: **9.92 Hz**; odometry: **24.48 Hz** during the full-stack acceptance window.
- NumPy ray casting for both 360-ray sensors against 393 configured obstacle parts: **6.54 ms mean / 7.17 ms p95**, over 100 paired scans. `test_logs/lidar_benchmark.json`.
- The dashboard's initial JavaScript chunk is approximately **216 KB / 67 KB gzip**; the approximately 963 KB 3D chunk loads separately, allowing telemetry and controls to initialize independently.
- Occupancy grids are capped at one million cells; rendered paths are bounded and sampled; stale streams clear or become unavailable; log history is capped.

## Runtime fixes discovered and verified

1. Renamed the action handle field to avoid overwriting the protected `rclpy.Node.handle` property.
2. Replaced per-ray scalar trigonometric loops with NumPy batch intersections. The original scalar implementation could starve physics and TF timers with two scanners; the vectorized path is cross-checked against analytic scalar intersections.
3. Set the DWB local goal tolerance to 0.1 m inside the goal checker's 0.2 m tolerance, resolving a robot that stopped near a goal without completing its action.
4. Required active Nav2 lifecycles and fresh SLAM map/localization, sensor streams and operator heartbeat before autonomy can start or continue.
5. Added a 0.02 m obstacle scan plane for floor-level pallet/rack footplate geometry that the roof scanner cannot observe.

## Operation and remaining limits

The complete ROS stack runs through Docker Compose with rosbridge exposed only on localhost:9090. The frontend runs on localhost:3000. See [README.md](../../README.md) for start/stop, native Humble, map saving and test commands.

Validation demonstrates the implemented simulation workflow. It does not claim exhaustive warehouse-wide route coverage, survey-grade SLAM accuracy, stochastic tire/traction dynamics, mesh-accurate sensor returns or real hardware certification. Map exploration and suitable free-space goals are required; unknown/occupied goals may reject or fail safely. External publishers must not bypass the bridge's `/cmd_vel` ownership. The supplied tests that command the live stack must run separately from operator use.

## Controller support follow-up

Added explicit gamepad mode, a 15% stick dead zone, speed caps, RB/R1 hold-to-drive, B/Circle stop/disarm, and neutral/released rearming. Gamepad mode excludes keyboard/directional-button input; Stop stays available. Focus loss, disconnect, stale telemetry and polling interruptions stop controller motion.

Eight additional unit tests bring the frontend total to 20 passing tests. A separate Chrome test injects a virtual standard controller and mocked ROS frames, verifies outgoing manual Twist commands, checks release/idle behavior, and exercises focus loss, telemetry expiry and unplugging. This test does not command the live robot. Physical controller hardware testing remains unperformed. The production build and Luna review pass. See `test_logs/controller_browser_results.json` and the README controller instructions.

Final controller regression run: **20/20 frontend tests**, **2/2 Chrome browser tests** (virtual controller plus real ROS dashboard), and the production build pass. The live WebSocket odometry stream also parsed 74/74 sampled messages. The controller browser fixture mocks only its own connection and does not leak virtual inputs into the real ROS dashboard test.

## Increased driving speed

Manual default speed is now 0.7 m/s, with a 1.2 m/s slider/backend ceiling; Nav2 is capped at 0.7 m/s. Angular limits and acceleration limits are unchanged. The wheel ceiling is 9.5 rad/s so simultaneous full linear and angular commands are not inadvertently clipped. Backend arbitration and physics share velocity constants.

The rebuilt, restarted stack reports live parameters of 1.2 m/s (simulator), 9.5 rad/s (wheels), and 0.7 m/s (Nav2). All **42 backend tests** and **20 frontend tests** pass, as does the production build. New ROS tests verify full linear speed, combined turning without wheel clipping, full-speed wall blocking, and timeout stopping. `test_logs/speed_validation.log`. The real SLAM/Nav2 end-to-end client passes again with goal arrival, cancellation and heartbeat stopping at the new settings.

**Historical report — superseded by docs/MULTI_AGV.md and docs/FLEET_ROLLING_VALIDATION.md**

> Evidence paths shown as `test_logs/...` are generated locally by the acceptance runs. `test_logs/` is gitignored, so those files are not tracked in Git.

# Live rack navigation verification

> This report predates the aisle-only rack policy. Its arrival and collision checks did not exclude travel underneath raised shelves. Use [rack aisle policy and validation](../RACK_AISLE_POLICY.md) for the corrected geometry and route validation.

Date: 2026-11-16. Local Docker ROS 2 Humble simulation, domain 72, existing SLAM map and Nav2. No synthetic map, pose reset, mocked ROS transport or auxiliary heartbeat was used for the live journeys. The real dashboard on `http://127.0.0.1:4174` supplied both goals and its normal operator heartbeat. Existing uncommitted feature work was retained.

## Findings and repair

Native ROS localization was already healthy: a six-second read-only probe received 120 map-to-odom transforms, with a largest gap of 59 ms. A ten-second raw rosbridge probe received 198 map-to-odom transforms. Earlier browser runs had logged `Write queue full, dropping outgoing message`; this was a browser transport/load symptom, not evidence that SLAM stopped publishing.

A reproducible freshness defect was present: the dashboard assigned every map transform the current arrival time. A transform generated five seconds ago but delivered from a queue could therefore enable rack travel. The added mapping regression failed before repair because `parseMapTransform` returned a fresh transform rather than `null`.

The parser now validates ROS wall-clock source timestamps, rejects transforms older than 1.5 seconds, and preserves the age of accepted transforms. It allows SLAM Toolbox's intentional 0.5-second future dating, rejecting timestamps more than one second in the future. Legacy unstamped fixtures retain receipt-time behavior. This project uses wall-clock ROS time, as declared in its launch configuration.

To reduce outgoing backlog, high-rate dashboard telemetry is capped at 10 Hz at rosbridge, with the map and static collision geometry capped at one message every two seconds and a queue length of one. `/tf` remains unthrottled because it multiplexes different frame pairs; dropping its intermediate messages indiscriminately could starve the map-to-odom frame. Simulator physics, ROS sensor publishing rates and backend watchdog limits are unchanged.

The broader live browser acceptance test reproduced the remaining rendering defect under SwiftShader: after toggling LiDAR, source-stamped TF in the browser was about 43.7 seconds old, odometry frames were about 44.2 seconds old, and the UI dropped to 2/10 readiness. Native ROS and the normal hardware preview continued working. No browser JavaScript errors were present. Red checks were retained; the test was not skipped or relaxed.

The viewport now detects software WebGL renderers (SwiftShader, llvmpipe, or software) and uses DPR 0.5, disables shadows and local point lights, and draws at up to 10 Hz. Camera and robot frame updates continue normally, and hardware rendering retains its existing settings. This avoids continuously overfilling the software GPU queue and starving ROS callbacks. Rendering ownership uses the installed React Three Fiber 8 `useFrame` positive-priority API; see [the official hook documentation](https://r3f.docs.pmnd.rs/api/hooks). Subscription throttling follows the [rosbridge protocol](https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/ROSBRIDGE_PROTOCOL.md).

The exact previously failing live browser test then passed (30.9 seconds including setup). The final full-suite run reported odometry source age of about 3 ms and map TF intentionally future-dated by about 421 ms, with all 10 health checks ready. The acceptance test now attaches ROS frame and source-age diagnostics on failure.

## Live outcome on the repaired build

The final production bundle `index-BFnnESaJ.js` was loaded from the preview service. The existing map was 635 × 395 cells at 0.1 m/cell.

| Check | Observed result |
|---|---|
| Requested journey | B2 source → D1 destination |
| Start state | Robot near the previous D1 arrival after a short goal/cancellation check, so both legs required physical movement |
| Source goal | Nav2 succeeded; map-position error 0.091 m |
| Destination goal | Nav2 succeeded; map-position error 0.091 m |
| Goal sequencing | Destination published after source success |
| Live plans | 44 received |
| Largest native map-TF arrival gap | 117 ms |
| Collision / blocked reports | None |
| Rosbridge queue-drop warnings during run | None |
| Dashboard completion | Route complete; 10/10 ready; stopped, 0.00 m/s |

The journey ran from 16:40:49 to 16:41:34 UTC (about 45 seconds). An earlier baseline journey also completed both goals before the freshness repair; it is retained as history, not evidence for the repaired build.

Evidence: `test_logs/rack_navigation_live/result.json`, `test_logs/rack_navigation_live/ui-result.json`, `test_logs/rack_navigation_live/transport.json`, `test_logs/rack_navigation_live/arrival-errors.json`, `test_logs/rack_navigation_live/baseline.json`.

## Regression validation

The final complete browser suite passed all four tests, including the live ROS dashboard flow with LiDAR toggles, goal submission/cancellation and disconnect/reconnect. See `test_logs/rack_navigation_live/browser-suite.log`.

- `cd frontend && rtk npm test`: 26 tests passed, including stale, malformed and intentionally future-dated localization transforms.
- `cd frontend && rtk npm run build`: TypeScript and production build passed.
- `cd frontend && rtk proxy npx playwright test e2e/rack-route.spec.ts e2e/controller.spec.ts --reporter=list --output=/tmp/agv-localization-regression`: three tests passed. The controlled ROS fixture verifies that stale TF keeps Start disabled until fresh localization arrives, normal traffic has bounded subscription rates, TF is unthrottled, goals are correctly sequenced, and stale telemetry interrupts the journey. This controlled test does not stand in for the live journey above.

To observe another live journey, run `rtk proxy node test_logs/rack_navigation_live/monitor.mjs` from the project root, then select different source/destination racks in the dashboard and start the route. The observer supplies no heartbeat or movement commands; it records goals, status transitions, physical poses, plans and collisions, with a four-minute timeout. It overwrites `result.json`, so preserve the previous evidence first. A successful run must contain `passed: true`; inspect the JSON rather than inferring success from process startup. Unknown or unmapped destinations can legitimately be rejected by Nav2.

## Limits and cleanup

This confirms B2 → D1 on the existing live SLAM map, including both rack arrivals. It does not establish warehouse-wide route coverage or success through unknown space. The simulator was left running and the robot was stopped. Agent-owned preview tabs and monitor sockets were closed. No ROS rebuild or SLAM reset was needed.

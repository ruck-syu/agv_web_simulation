**Historical report — superseded by docs/MULTI_AGV.md and docs/FLEET_ROLLING_VALIDATION.md**

# Phase 2 frontend review fixes — 2026-11-17

Work performed in place; no commit, push, or branch. Existing changes were preserved.

## Finding outcomes

| # | Outcome | Implementation and regression coverage |
|---|---|---|
| 1 | Fixed | Drive keys and Space work directly from robot radios; only text-entry controls suppress drive shortcuts. Fleet e2e keeps selector focus. |
| 2 | Fixed | Fresh fleet status is required for keyboard, pointer, and gamepad driving. A safety-stop assertion clears held input and disarms gamepad. Fresh retreat gestures are allowed with 0.2 m/s and 0.3 rad/s caps; backend checks separation-increasing motion. Keyboard and enabled-gamepad regressions isolate fleet staleness from truth staleness. |
| 3a | Fixed | Optional request_id echoed by coordinator disambiguates queued terminal status. Uncorrelated terminal status is ignored until acknowledgement; existing 10-second no-ack timeout remains. |
| 3b | Fixed | Correlated succeeded is authoritative with no frontend position/yaw tolerance. E2e covers immediate success without busy, goal=null, pose outside old tolerance, stale success between legs, and queued canceled status. |
| 4 | Fixed | Unsafe cancellation latches until safe recovery or a new locally sent goal. E2e asserts two total cancels for a persistent fleet stop. |
| 5 | Fixed | Stop all is disabled when disconnected; failures are collected and displayed per robot while attempting both publishes. E2e injects an agv1 transport exception and checks the error. Active rack jobs are stopped and cannot dispatch another leg from a late success. |
| 6 | Fixed | Ctrl/Meta/Alt gestures are ignored without preventing the browser shortcut. E2e exercises all three. |
| 7 | Fixed | SIM/SAFETY sources include robot id; truth and cmd_vel log topic names include namespace. E2e checks both robots' truth and malformed-collision logs. |
| 8 | Fixed | Both LiDAR toggles identify the selected robot. E2e changes agv1 visibility and confirms agv2 remains visible with its own label. |
| 9 | Fixed | Path decimation always includes the final pose. Unit coverage: 2001, 4000, and 20000 input poses. |
| 10 | Fixed | Removed unused RosTestPanel, MappingPanel, MappingProvider, test/ack subscriptions and obsolete public test API/config. Mapping parsing utilities remain because unit tests exercise them. Build validates no dangling imports. E2e checks no legacy test/ack subscription. |
| 11 | Fixed | Heartbeat messages are asserted to contain exactly data='alive', matching FleetNode.heartbeat's string comparison. Gamepad is actually enabled/driven before selection/disarm assertions. Stop all is exercised with active jobs. Only agv2 truth is paused for per-robot staleness while fleet/agv1 continue. Unit test title describes parser rejection. AGV_FLEET_E2E=1 requires live fleet data instead of skipping. |

## Contract change

Only backend changes for this task: fleet_coordinator.py adds optional string request_id correlation in robot status; test_fleet_coordinator.py covers retention after goal clearing, replacement, and missing-id compatibility. Existing fleet fields and schema version 1 remain unchanged. MULTI_AGV.md documents this and corrects its contradictory earlier 2.3 m paragraph to the 3.0 m stop / 3.3 m clear policy.

## Files changed by this task

- frontend/src/simulation/SimulationControls.tsx, SimulationProvider.tsx
- frontend/src/fleet/FleetProvider.tsx, FleetPanel.tsx
- frontend/src/navigation/NavigationProvider.tsx, RackRouteProvider.tsx, types.ts
- frontend/src/components/dashboard/LidarPanel.tsx
- frontend/src/ros/RosProvider.tsx; frontend/src/config/appConfig.ts
- Removed frontend/src/components/dashboard/{RosTestPanel,MappingPanel}.tsx and frontend/src/mapping/MappingProvider.tsx
- frontend/e2e/{fleet,controller,dashboard,navigation-ack,live-smoke}.spec.ts
- frontend/tests/{fleet,navigation}.test.mjs
- ros2_ws/src/agv_web_bridge/agv_web_bridge/fleet_coordinator.py
- ros2_ws/src/agv_web_bridge/test/test_fleet_coordinator.py
- docs/MULTI_AGV.md and this report
- Regenerated frontend/dist build assets and test_logs result artifacts

Other working-tree changes predate this task and are not claimed here.

## Validation

- npm test: 32 passed, 0 failed, 0 skipped.
- npm run build: passed (TypeScript and Vite; 691 modules).
- Host backend unittest discovery: 81 total, 63 passed, 18 ROS-dependent skips.
- Docker full backend discovery (ROS_DOMAIN_ID=89): 81 passed, 0 skipped, 43.764 seconds.
- docker compose up -d --build: passed. Both robots started; live topic discovery and subscriptions confirm /fleet/state and both robot namespaces. Compose remains running.
- Dedicated live motion smoke: 1 passed in 2.5 minutes (AGV_FLEET_E2E=1 AGV_FLEET_SMOKE=1 npx playwright test e2e/live-smoke.spec.ts). Final exact AGV_FLEET_E2E=1 npm run test:e2e: 5 passed, 1 intentionally skipped (the opt-in motion smoke), 0 failed, 1.2 minutes. The motion smoke was run separately and passed.

## Live smoke evidence and limitations

The full-render software-WebGL smoke failed with per-robot telemetry staleness while fleet status remained fresh. The UI interrupted motion as designed. This is retained as a failed full-render live-motion acceptance attempt, not represented as a pass. The separate real-3D offline rendering e2e and live sensor/connection test passed.

The dedicated live ROS smoke omits WarehouseCanvas to avoid software-rendering contention, while using real dashboard providers, controls, subscriptions and coordinator. It dispatches agv1 B2→D2 and agv2 A2→C2, checks both busy, clicks Stop all, verifies both canceled and stable world poses across fresh fleet snapshots, then restarts both rack jobs and waits for both complete. JSON evidence is in test_logs/fleet_live_smoke.json.

Two supplied backend expectations are still absent from the current coordinator source (outside the authorized backend contract-addition scope): a zero manual Twist changes an autonomous robot to manual and clears its goal; an identical busy goal resets requested time. Read-only pure-coordinator probes reproduced both: zero Twist yielded state=manual/goal=None; a repeated goal moved requested from 100.0 to 100.5. Follow-up: both are now fixed in `fleet_coordinator.py` (zero Twists are ignored unless already manual; an identical busy goal keeps its reservations and timers and only adopts a new `request_id`), covered by `test_fleet_coordinator.py`.

Final dedicated smoke: both full rack jobs reached Route complete; agv1 ended near (-12.05,-12.98), agv2 near (-11.96,-5.27). Minimum separation 6.006 m; 0 collision/blocked reports. Stop all canceled both jobs, released reservations, and both world poses remained stable within 0.01 m/rad. The final cleanup stopped both robots and left Compose running.

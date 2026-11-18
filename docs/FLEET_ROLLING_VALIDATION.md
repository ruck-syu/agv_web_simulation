# Rolling fleet review validation — 2026-11-18

Implemented in place; no branch, commit or push. Existing unrelated edits preserved. The dashboard on port 3000 remains running; compose remains running.

## Findings and outcomes

| # | Outcome | Implementation / regression |
|---|---|---|
| 1 | Fixed (heading error alone already worked with a clear chord) | Pivot commands bypass the chord gate. Translating carrots shrink through dense samples. `test_blocked_chord_still_pivots`, `test_blocked_carrot_shrinks_to_clear_sample`. |
| 2 | Fixed | Segment clearance visits every crossed grid-cell interval and checks continuous peer distance; fillets validate emitted samples. Subdivision and seed-5 regressions cover the mismatch. |
| 3 | Fixed | A transition from navigating into waiting starts a new wait clock; repeated waiting retries retain it. `test_midroute_wait_starts_now`. |
| 4 | Fixed | BFS finds reachable holding cells outside the complete winner route/destination; a return component is required with the winner parked. Parked peers that sever an otherwise valid route fail explicitly. Bay/return-route and parked-corridor regressions cover both. A side bay must have a traversable entrance; disconnected geometry cannot resolve a head-on conflict. |
| 5 | Fixed | Every fresh plan removes the previous yield target; watchdog release clears it too. Two regressions check status and path behavior. |
| 6 | Fixed | Only translation updates holder liveness. Watchdog retries cannot pretend to be translation. The former spinning-holder test now expects bounded failure. |
| 7 | Fixed | Predicted occupancy keeps all <=0.08 m samples instead of every fifth sample. `test_prediction_keeps_dense_peer_samples`. |
| 8 | Fixed | Conflict replanning bypasses optimizer timing. Optional optimization cannot replace a valid path with waiting. Both cases have coordinator regressions. Accepted-plan counts are cumulative in fleet state; compare scenario deltas. |
| 9 | Fixed | Sampled one-second pursuit arcs are checked segment by segment. Unsafe translation falls back to a pivot. The regression has a clear chord but an arc intersecting an occupied cell. |
| 10 | Fixed | The tracked smoke harness reports both progressing toward their own goals separately from yield/retreat motion. Closest relative position is interpolated between truth samples; this assumes linear movement between observations. A pure-Python synthetic crossing checks interpolation and retreat classification. Live close approach exercises the 3.0/3.3 m latch and manual retreat. |
| 11 | Fixed | Removed unused visibility-graph `planRoute`; preview tests exercise `planFleetRoute`. Backend/frontend reject continuous out-of-bounds endpoints. ROS unittest re-exports the authoritative grid through `scripts/export_fleet_grid.py --check`; point-for-point route fixtures were regenerated. |
| 12 | Fixed | New request id is installed before unavailable rejection. `test_rejected_request_has_new_id`. |
| 13 | Fixed | Corridor coverage now builds actual obstacles through normal inflation. Truth staleness is named accurately and a separate fresh-truth/stale-scan test checks the sensor gate. |

A further shrink-fallback regression prevents a nearby (<0.08 m) sample from returning a zero command before a required pivot. This resolved seeds 13 and 134 in the patched fuzz run.

## Regression evidence

Before editing production code, the new regression run recorded eight failures (the unavailable-request test subsequently needed its missing action field corrected). Seed 5's emitted-path check failed directly on the original implementation. Additional targeted checks were introduced during implementation: an in-memory replay of the captured original coordinator branches confirmed 13 failing assertions for pivot, shrink, wait clocks, stale escape, rotation progress, conflict timing, unavailable id, optimizer downgrade, prediction spacing, bay selection, parked-corridor failure, and arc clearance. This replay is distinct from a full untouched-tree baseline run. Final regressions include seeded end-to-end replay of 5, 11, 12, 13, 44 and 134.

Regression source is committed-workspace material under `ros2_ws/src/agv_web_bridge/test/`; it has no dependency on ignored evidence files. Runtime grid parity calls the tracked exporter. Metrics and live harnesses are tracked under `scripts/`.

## Historical rolling-planner fuzz

Haiku's fake-clock ideal-kinematics fuzz was copied into `test/fleet_fuzz.py`, with a portable import path. Its scenario generation and dispatch semantics are retained to permit comparison. This models neither physical acceleration nor ROS timing.

| Outcome | Before | After |
|---|---:|---:|
| Requested seeds | 200 | 200 |
| Valid runs | 188 | 188 |
| Skipped starts | 12 | 12 |
| Both succeeded | 151 | 164 |
| At least one non-success | 37 | 24 |

Of the remaining 24 seeds, 23 end with an explicit parked-peer goal failure: 19, 30, 33, 43, 57, 59, 61, 69, 71, 80, 85, 93, 95, 98, 99, 125, 128, 151, 154, 155, 168, 174, 183. Seed 41 times out for agv2, after which agv1 promptly reports its route blocked by the parked agv2. This is a remaining coordination limitation, not a successful delivery or proof of universal liveness. No run reported separation below 3.0 m. The route planner still does not guarantee delivery for arbitrary paired destinations/layouts.

Reproduce: `python3 ros2_ws/src/agv_web_bridge/test/fleet_fuzz.py 200`.

## Historical rolling-planner checks

Final counts and live measurements follow below. Evidence logs and complete sampled timelines remain in ignored `test_logs/`; all correctness claims and reproduction commands are summarized here.

- Host: `python3 -m unittest discover -s ros2_ws/src/agv_web_bridge/test` — 113 tests in 7.428 s, 94 passed, 19 ROS-dependent skips.
- Rebuilt Humble image: same discovery on isolated `ROS_DOMAIN_ID=99` — 113 passed in 50.177 s; zero skips/failures. Grid re-export check passed in the same environment.
- `cd frontend && npm test` — 32 passed, zero failures/skips. `npm run build` — TypeScript and Vite passed.
- `docker compose up -d --build`, `git diff --check` — passed. Dashboard HTTP :3000 returned 200; compose simulation and preview remain running.

The live acceptance command is `docker compose exec -T simulation bash -c 'source /opt/ros/humble/setup.bash; source /opt/agv_ws/install/setup.bash; python3 /workspace/scripts/fleet_concurrency_smoke.py'`. It commands compose domain 72; the unittest domain is independent. `python3 scripts/summarize_fleet_smoke.py test_logs/fleet_concurrency_smoke.json` recomputes metrics from the raw truth timeline. Angular rates estimated from asynchronous truth samples are not a verified physical angular-speed bound.

## Files changed during this review implementation

- Backend: `fleet.py`, `fleet_coordinator.py`.
- Tests: `test_fleet_coordinator.py`, `test_rolling.py`, `test_fleet_runtime.py`, new `test_review_regressions.py` and portable `fleet_fuzz.py`.
- Frontend: `src/navigation/routePlanner.ts`, `tests/routePlanner.test.mjs`, regenerated `tests/fixtures/fleetRoutes.json`, generated `dist/` bundles.
- Scripts: `export_fleet_grid.py`, new `fleet_concurrency_smoke.py`, new `summarize_fleet_smoke.py`.
- Docs: this document and `MULTI_AGV.md`.
- Ignored evidence: original probes, before/after regression and fuzz output, build/test logs and live JSON under `test_logs/`.

No branch, commit or push was performed. The earlier 3.0 m stop / 3.3 m clear latch, manual retreat, zero-Twist autonomy behavior, identical busy goal handling, request correlation, and fleet schema version 1 remain covered by the suite.

## Historical rolling-planner live acceptance

| Scenario | Both moving s | Both toward own goals s | Yield/retreat s | Interpolated minimum m | Collisions | Result |
|---|---:|---:|---:|---:|---:|---|
| head_on_same_aisle | 21.442 | 8.170 | 13.273 | 5.081 | 0 | Both succeeded |
| crossing | 26.841 | 26.841 | 0.000 | 3.677 | 0 | Both succeeded |
| Close approach (manual) | n/a | n/a | Manual retreat verified | 2.976 | 0 | Latch triggered and cleared |

Close approach entered the 3.0–3.3 m band, triggered the below-3.0 m latch, and cleared only after manual retreat exceeded 3.3 m. The intentionally sub-3.0 m minimum exercises the stop, rather than representing autonomous route clearance. Both staging requests completed successfully; staging does not require concurrent motion. The final crossing accepted 10 plans for agv1 and 1 for agv2 (cumulative counts minus preceding staging counts), compared with the reviewed crossing's 12 for agv1. Zero sampled waiting time was recorded for either robot in the final crossing; plan count alone does not measure stop/go.

The first live attempt was interrupted during an unnecessarily long close-staging detour. Its evidence is retained separately, and it is not counted as final close-approach validation. After changing staging to keep agv1 in place and approach from its unobstructed side, the final rebuilt stack ran all scenarios above. The final JSON was re-summarized using the tracked pure-Python metric implementation, including retreat without a yield flag.

## Paired routes and cruise review

The baseline reproduced the A2/B1 half-success, with the failed robot stopping 4.525 m from its goal. It also reproduced close-approach latch samples of 2.880–2.942 m and a 1.639–1.701 m minimum in the reviewer’s extended coordinator-silence replay. The regression tests cover conflicting combinations of rack stops, cancellation during destination legs, failure propagation, ordered Stop all, braking and watchdog margin, over-speed admission, superseded jobs, and invalid cruise startup. The frontend had 33 unit tests before this review. The rolling-planner checks above record 32 before Start both coverage was added.

Start both submits both rack legs under one ID. The dashboard disables it when any cross-robot combination of stops is closer than 3.32 m. The coordinator performs the same check and owns both destination transitions. A terminal failure or timeout interrupts the active peer route. Stop all sends one global command on the pair topic, ordered behind pending admission. A correlated cancel remains available for a specific pair. The v1 state publishes an optional `pair_leg` alongside the existing request ID.

### Same-controller cruise comparison

The replay uses the current controller and arrival tolerances at **both** cruise settings. It models 50 Hz physics, 25 Hz truth, 10 Hz control, acceleration, wheel clamping, and differential-drive integration. The same three goal-pair scenarios run at five starting tick phases. Each column represents 30 of 30 completed goals, zero goal-plane overshoot and zero inflated-map intrusions.

| Simulator-rate measure | 0.45 m/s | 1.0 m/s |
|---|---:|---:|
| Final position mean / p95 (m) | 0.01729 / 0.01847 | 0.01751 / 0.01889 |
| Final yaw mean / p95 (rad) | 0.03272 / 0.05141 | 0.03291 / 0.05097 |
| Cross-track mean / p95 / max (m) | 0.03803 / 0.06477 / 0.06477 | 0.03749 / 0.06153 / 0.06153 |
| Per-robot trip time mean / p95 (s) | 44.06 / 68.04 | 29.31 / 54.44 |

Mean trip time fell by 33.5%. Mean position error increased by about 0.22 mm and both p95 errors stayed below 0.02 m. The earlier comparison between the legacy 0.10 m arrival tolerance and the 0.02 m terminal-approach controller combined controller and cruise changes. Run `python3 ros2_ws/src/agv_web_bridge/test/test_fleet_speed_profile.py` to reproduce both columns in a single command.

The two-body braking calculation gives **2.525 m** with normal control, **2.300 m** with the coordinator stalled, and **2.484 m** if the stall begins during the ramp from full speed. The limiting stalled case preserves **0.422 m** over the arbitrary-yaw contact distance with the default simulator. [Timing assumptions and braking calculation](MULTI_AGV.md#frontend-ros-contract).

### 200-seed replay across revisions

| Outcome | Original rolling planner | Rolling review fixes | Cruise change | Current review |
|---|---:|---:|---:|---:|
| Valid seeds | 188 | 188 | 188 | 188 |
| Skipped starts | 12 | 12 | 12 | 12 |
| Both succeeded | 151 | 164 | 165 | 165 |
| At least one goal failed | 37 | 24 | 23 | 23 |

The current replay had 13 seeds where only agv1 succeeded and 10 where only agv2 succeeded. Every failure identified a parked peer, and no seed fell below 3.0 m. The fuzz tool dispatches independent goals in an ideal-kinematics model. The paired admission and robot-side watchdog use separate tests.

### Live Compose acceptance

| Scenario | Result |
|---|---|
| A2 / B1 (1.36 m apart) | Start both was disabled and explained the conflict for each robot. The dashboard sent zero starts. A separate direct ROS submission returned both issues and admitted neither robot. |
| Stop all on the destination legs | One global command canceled both active legs. The robots were moving at 1.000 and 0.024 m/s when stop was requested and both settled to 0.000 m/s. No per-robot stop messages were sent. |
| Head-on at 1.0 m/s, A1 → B1 and D2 → C1 | 4/4 legs succeeded in 135.41 s. Both robots reached 1.0 m/s. Minimum sampled separation was 3.919 m. Maximum position and cross-track errors were 0.01856 m and 0.07863 m. Zero collision, blocked, rack-intrusion or overshoot samples. |

Chrome exercised the dashboard controls against the live Vite server and Compose ROS domain 72. The live browser run skipped software rendering of the 3D canvas to limit heartbeat delays. The ROS transport and simulator were live. `test_logs/fleet_concurrency_smoke.json` stores the raw timelines in `pair_review` alongside the earlier evidence.

Run `scripts/fleet_pair_live.py head_on` inside the Compose simulation container with the ROS and workspace setup files sourced. Wait for its readiness message, then select the routes above and click Start both. To exercise Stop all after the head-on trip, reverse both routes and run the same harness with `--skip-stage --expect stop`. The `--skip-stage --expect rejection` mode submits A2/B1 directly to the pair topic.

### Current verification

- Host unittest discovery ran 129 tests in 13.478 s, with 107 passed and 22 ROS-dependent skips.
- Humble unittest discovery ran all 129 tests in 59.522 s on isolated ROS domain 99. This includes the exported grid check, late-command rejection, steady-time watchdog, and fatal startup diagnostics for invalid cruise parameters.
- Frontend `npm test` passed 34 of 34. `npm run build` passed TypeScript and Vite with a temporary output directory.
- All four mocked Playwright specs passed, including the paired acknowledgement timeout and the superseded-route regression.
- `docker compose up -d --build` completed and domain 72 remained available for live checking.

### Files changed in the current review

- Coordinator and physics. `fleet.py`, `fleet_coordinator.py`, `fleet_node.py`, `fleet_simulation.py`, `motion_limits.py`, `simulation_node.py`.
- Dashboard and route state. `FleetPanel.tsx`, `FleetProvider.tsx`, `fleet/types.ts`, `RackRouteProvider.tsx`, `navigation/types.ts`, `appConfig.ts`, `SimulationProvider.tsx`, `SimulationPanel.tsx`.
- Regressions. `fleet.test.mjs`, `fleet.spec.ts`, `navigation-ack.spec.ts`, `test_fleet_coordinator.py`, `test_fleet_runtime.py`, `test_fleet_speed_profile.py`, `test_odometry_runtime.py`, `test_speed_runtime.py`.
- Live harness and docs. `scripts/fleet_pair_live.py`, `README.md`, `MULTI_AGV.md`, and this report.

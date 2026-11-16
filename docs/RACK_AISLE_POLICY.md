# Rack footprints are not traffic lanes

## Cause and correction

The original collision model contained uprights, footplates, end guards and elevated shelving, but no solid reserved floor footprint. The 0.96 m AGV fit below the first shelf (approximately 1.185 m underside). Both planar scan planes could see through bay openings, so SLAM/Nav2 treated them as navigable. Earlier arrival/collision verification did not test aisle-only travel; its success was insufficient for the intended warehouse behavior.

`SimulationNode._build_rack_obstacles` now adds a floor-to-rack-height `RACK-…-NO-DRIVE` box per row. Each box covers the entire 24 m row plus the footplate extents: half-length 12.17 m, half-depth 0.77 m. Existing detailed rack structure remains. These conservative reserved-storage volumes participate in physical collision prevention and both simulated LiDAR scan planes, so SLAM/Nav2 observes a closed rack boundary. This is a deliberate conservative warehouse traffic policy, rather than a claim that an empty shelf bay is physically solid.

There are eight reserved rack rows. Manual and autonomous movement share the same collision handling. Navigation still uses real scan-derived SLAM and disallows unknown space; no prefilled synthetic map was installed and no sensor or watchdog limit was weakened.

## Tests and live verification

- New regression tests failed before repair: bay centers allowed the full robot underneath shelving, LiDAR saw through a bay, and manual driving entered it.
- After repair, all **46 backend tests** passed in isolated ROS domain 76. The new cases check all 64 bay centers, both scan planes, open aisle clearance, and manual entry prevention.
- Rebuilt `agv-warehouse:humble` and restarted the local simulation. The running simulator now has 401 collision objects, including the eight reserved volumes.
- Archived the previous SLAM graph before restart at `test_logs/rack_aisles/before_rack_zones.data` and `.posegraph` (ignored by Git). The old map was not restored because its free space reflected the previous geometry.
- Built fresh SLAM observations by driving the existing open east cross aisle and the lower rack aisle. Mapping-drive waypoints were (4.4, 1.6), (4.4, -6.68), and (-12, -6.68). No pose reset or teleport was used during mapping or the acceptance journey.

The final native ROS/Nav2 acceptance sent a B2 approach goal, confirmed arrival, then sent the D1 approach goal. It checked every published path pose's full oriented AGV footprint against all eight reserved rack volumes, and checked every received ground-truth footprint as the robot moved.

| Final check | Observed result |
|---|---|
| B2 arrival error in physical warehouse coordinates | 0.137 m |
| D1 arrival error in physical warehouse coordinates | 0.080 m |
| Actual Nav2 plans received | 64 |
| Planned footprints checked | 5425 |
| Recorded physical footprints checked | 1628 |
| Furthest east planned center | 1.790 m, beyond the rack ends |
| Rack intrusion or collision blocking | None |
| Result | PASS |

Evidence: [backend test output](../test_logs/rack_aisles/backend-tests.log), [final live result and trajectory](../test_logs/rack_aisles/live-result.json), [mapping drive](../test_logs/rack_aisles/mapping-drive.json). Reproduce against a dedicated local simulation with `docker compose exec -T simulation bash -c 'source /opt/ros/humble/setup.bash && source /opt/agv_ws/install/setup.bash && python3 /workspace/test_logs/rack_aisles/verify_live.py'`. The acceptance client supplies its own operator heartbeat and navigation commands; this is a native planner/physics check, not a browser interaction test.

## Coverage and retained evidence

The first traversal after rebuilding the map found no rack intrusion across 5,484 planned footprints, but its strict physical arrival check failed by 0.412 m while SLAM closed the initial mapping loop. That failed result is retained in [first-loop-result.json](../test_logs/rack_aisles/first-loop-result.json). The final run passed the unchanged 0.3 m arrival bound on the updated live map; the bound was not loosened.

This verifies B2 → D1 and the reserved-volume behavior of every rack bay. It does not establish route coverage through unmapped aisles. The ROS simulation and local frontend remain running; the acceptance client stopped the robot and exited.

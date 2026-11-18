**Historical report — superseded by docs/MULTI_AGV.md and docs/FLEET_ROLLING_VALIDATION.md**

# Phase 3/4 Fix Report — AGV Web Simulation

**Status:** PASS (Phase 3/4 fixes complete)
**Date:** 2026-11-15
**Project:** `~/agv_web_simulation`

## Scope

Fixes for the Phase 3/4 review:

- False/incorrect collision results around racks, pallets, walls, and aisle edges.
- Collision debug geometry that did not match the authoritative backend.
- Camera controls that did not follow the AGV or respond to dashboard controls.
- Runtime verification, screenshots, and this report.

Phase 5 (LiDAR) was not started.

## Root Causes

1. **Installed ROS package was stale.** The installed `warehouse_collision.json` and node were from an older build (`07:42`) than the source (`08:05`). The installed config used a `1.56 × 1.06 m` footprint plus `0.02 m` padding (effective `1.60 × 1.10 m`), while the visual model uses `1.55 × 1.06 m`. The earlier `10/10 PASS` result was produced against that stale install.
2. **Camera/viewport wiring was disconnected.** `App.tsx` passed `view`/`resetToken` props that `WarehouseCanvas` no longer accepted, and `CameraRig` called `useViewport()` without a mounted provider. The camera therefore stayed in a static overview and the new controls could not drive it.
3. **Debug geometry was ambiguous near racks.** Rack end-guards reused the rack object ID (for example two `RACK-B-02` guards). A blocked guard could highlight the opposite end or report an ambiguous object.

The backend OBB/SAT collision math itself was not replaced; it was retained and verified after rebuilding.

## Changes

### Backend

- Rebuilt and reinstalled `agv_web_bridge` so the runtime matches source.
- Confirmed authoritative footprint: `1.55 × 1.06 m`, padding `0.0` (exports `footprint_length=1.55`, `footprint_width=1.06`, `footprint_padding=0.0`).
- Added an SAT contact-point calculation so collision debug reports a contact location rather than only the obstacle centre.
- Made rack guard IDs unique (`RACK-A-01-GUARD-W`, `RACK-A-01-GUARD-E`, etc.) so the blocking object and highlighted geometry are unambiguous.
- Kept blocking fail-safe behavior: the robot stops rather than penetrating or faking a clear path.

### Frontend

- Mounted `ViewportProvider` above the app and removed the obsolete `view`/`resetToken` API.
- Rebuilt camera control flow with `overview`, `follow`, and `close` modes:
  - smooth 0.95 s preset transitions
  - follow from authoritative `/odom` via `getLatestTelemetry`
  - Focus AGV, AGV close, Overview, Storage, Reset view
  - follow distance clamping and camera obstacle clearance
- Added viewport controls to both the overlay and dashboard:
  - Overview / Storage / Follow AGV / AGV close
  - Focus AGV / Reset view / fullscreen
  - Show Collision Geometry toggle and legend
- Debug wireframes now use the backend `/agv_web/collision_geometry` payload and shared collision styles.
- Preserved ROS indicator, manual movement controls, telemetry, collision status, log, and warehouse model.

## Verification

### Backend runtime tests: 15/15 PASS

Command:

```bash
source /opt/ros/humble/setup.bash
source ~/agv_web_simulation/ros2_ws/install/setup.bash
cd ~/agv_web_simulation
python3 test_logs/phase3_4_test_runner.py
```

| # | Test | Result | Key measurement |
|---|------|--------|-----------------|
| 1 | forward | PASS | Δx=0.385 m |
| 2 | backward | PASS | Δx=-0.385 m |
| 3 | turn_left | PASS | Δyaw=0.579 rad |
| 4 | turn_right | PASS | Δyaw=-0.585 rad |
| 5 | stop | PASS | post-zero travel 0.0187 m |
| 6 | wall_collision | PASS | blocked by `wall_north`, front edge 19.697 m |
| 7 | rack_collision | PASS | blocked by `RACK-C-01`, front edge -0.976 m |
| 8 | pallet_collision | PASS | blocked by `PALLET-STAGE-01`, front edge -11.368 m |
| 9 | rotate_near_rack | PASS | blocked by `RACK-C-01` |
| 10 | cmd_timeout | PASS | timeout stop, travel 0.1147 m |
| 11 | aisle_center | PASS | Δx=4.737 m, no block |
| 12 | aisle_edge_clearance | PASS | 0.10 m from `RACK-B-02`, no block |
| 13 | aisle_ab_center | PASS | Δx=3.937 m, no block |
| 14 | aisle_cd_center | PASS | Δx=3.935 m, no block |
| 15 | rotate_in_aisle | PASS | Δyaw=1.955 rad, drift 0.0000 m |

Full results: `test_logs/phase3_4_test_log.md` and `test_logs/phase3_4_results.json`.

### Frontend build

```bash
cd ~/agv_web_simulation/frontend
npm run typecheck
npm run build
```

Both completed successfully.

### Browser/runtime verification

Verified against the production preview (`http://127.0.0.1:4173`) with rosbridge and the rebuilt simulator running:

- ROS bridge connected; `/odom` live at ~25 Hz in the dashboard.
- Follow mode selected and camera tracked the AGV while driving from `x=-2.800` to `x=-2.023`.
- AGV close and Storage presets rendered the expected viewpoints.
- Collision debug enabled and backend geometry displayed.
- Collision test: AGV blocked by `RACK-B-02` at approximately `(-1.692, 3.314)` with heading `1.770 rad`; dashboard reported **Movement blocked — Object: RACK-B-02 (rack)**.

Headless Chromium used software WebGL and required about 20 seconds of warm-up before the first `/odom` UI frame; this is a test-environment limitation, not a simulation latency issue.

## Screenshots

All images: `docs/screenshots/phase3_4/`

1. `01_overview_initial.png` — overview with live backend.
2. `02_follow_agv.png` — follow mode.
3. `02b_follow_after_drive.png` — follow mode after driving; AGV remains tracked.
4. `03_agv_close_view.png` — close camera preset.
5. `04_storage_racks.png` — storage/rack preset.
6. `05_collision_geometry_debug.png` — collision geometry wireframes.
7. `06_collision_blocked.png` — blocked by `RACK-B-02`; red footprint and contact marker.

The six required review images are `01`, `02`, `03`, `04`, `05`, and `06`; `02b` is supporting evidence.

## Result Summary

| Item | Result |
|------|--------|
| Collision footprint matches visual model | PASS |
| Installed runtime matches source | PASS |
| Rack/pallet/wall blocking | PASS |
| Aisle clearance at 0.10 m | PASS |
| Aisle rotation without false collision | PASS |
| Backend command timeout stop | PASS |
| Camera follow from `/odom` | PASS |
| Overview/Storage/Close/Focus/Reset controls | PASS |
| Collision debug toggle and geometry alignment | PASS |
| Runtime screenshots | PASS |
| Phase 5 LiDAR | NOT STARTED (out of scope) |

## Running Locally

```bash
# Services
source /opt/ros/humble/setup.bash
source ~/agv_web_simulation/ros2_ws/install/setup.bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml

# In a second shell
source /opt/ros/humble/setup.bash
source ~/agv_web_simulation/ros2_ws/install/setup.bash
ros2 run agv_web_bridge simulation_node

# Frontend development server
cd ~/agv_web_simulation/frontend
npm run dev -- --host 127.0.0.1 --port 5173
# http://localhost:5173

# Production preview (used for screenshots)
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
# http://localhost:4173
```

During this verification both `5173` (Vite dev) and `4173` (production preview) were running inside WSL. The browser must reach rosbridge at `ws://localhost:9090`.

## Files Changed

Backend:

- `ros2_ws/src/agv_web_bridge/agv_web_bridge/simulation_node.py`
- `ros2_ws/src/agv_web_bridge/config/warehouse_collision.json`

Frontend:

- `frontend/src/App.tsx`
- `frontend/src/main.tsx`
- `frontend/src/config/warehouseConfig.ts`
- `frontend/src/viewport/ViewportProvider.tsx`
- `frontend/src/warehouse/WarehouseCanvas.tsx`
- `frontend/src/warehouse/CollisionDebugLayer.tsx`
- `frontend/src/warehouse/collisionStyles.ts`
- `frontend/src/components/warehouse/ViewportOverlay.tsx`
- `frontend/src/components/dashboard/ViewportPanel.tsx`
- `frontend/src/components/dashboard/SidePanel.tsx`
- `frontend/src/simulation/SimulationProvider.tsx`
- `frontend/src/styles/global.css`

Tests/docs:

- `test_logs/phase3_4_test_runner.py`
- `test_logs/phase3_4_test_log.md`
- `test_logs/phase3_4_results.json`
- `docs/history/PHASE_3_4_FIX_REPORT.md` (moved to `docs/history/`)
- `docs/screenshots/phase3_4/*.png`

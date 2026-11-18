# AGV Warehouse Simulation

A React/TypeScript/Three.js warehouse dashboard driven by a ROS 2 Humble two-AGV fleet simulator. Two robots (`agv1`, `agv2`) run under a fleet coordinator with namespaced `/agvN/...` topics, simulated world-geometry path planning and ground-truth localization. The simulator owns physical motion, collision decisions and traffic reservations; the browser displays received data and submits commands. Phases 1–9 are integrated.

For migration to another machine or a handoff to another coding model, read [MODEL_SETUP_GUIDE.md](MODEL_SETUP_GUIDE.md).

## Two-AGV backend default

Docker starts two robots (`agv1`, `agv2`) with a fleet coordinator. The dashboard controls both using namespaced ROS topics and world coordinates. Read [MULTI_AGV.md](docs/MULTI_AGV.md) for the reservation protocol and simulation-ground-truth localization contract. The single-robot SLAM/Nav2 launches and saved checkpoints remain available for backend workflows, but they are **legacy single-robot modes that the current dashboard cannot drive**; this dashboard targets `agv_fleet.launch.py`.

## Start on this Mac with Docker

Start Docker Desktop, then from the repository root:

```bash
rtk proxy docker compose up -d --build
cd frontend
rtk npm ci
rtk npm run dev -- --host 127.0.0.1
```

Open **http://127.0.0.1:3000**. rosbridge is bound to **ws://localhost:9090**. No ROS installation on macOS is needed; the image installs Humble, builds the package and starts the complete stack. A Linux ARM64 image runs natively on Apple Silicon; Docker selects the appropriate architecture on other hosts. First build downloads ROS dependencies.

To stop ROS: `rtk proxy docker compose down`. To view ROS logs: `rtk proxy docker compose logs --tail 100 simulation`. Changes to ROS source/config require a rebuild (`docker compose up -d --build`); the image deliberately uses its built source rather than copied host build/install folders. The workspace mount is for test reports and exported maps.

The optional Nginx `preview` service on port 4174 mounts `frontend/dist` read-only, so run `npm run build` before starting it; see [PREVIEW.md](docs/PREVIEW.md).

## Operate

1. Check **Fleet coordination** for fresh status and separation, then select **agv1** (cyan) or **agv2** (orange) under **Control robot**. The selected robot owns the manual controls, goal form, rack selectors and telemetry panels. Scene and overhead map show both robots, labeled paths and shaded reserved traffic tiles.
2. Hold keyboard/directional controls or enable the gamepad to drive the selected robot. Switching robots stops and disarms manual input on the previous robot. Manual takeover cancels that robot's autonomous request. Wheel odometry and physical world truth remain separate diagnostics.
3. Enter a goal in **world metres** and choose **Navigate to goal**, or set that robot's source/destination racks and choose **Start rack route**. Fleet mode uses simulated world localization and geometry planning; it has no SLAM map or Nav2 action server.
4. Select the other robot, set its own route and start it. Both jobs and operator heartbeats remain active independently of selection. Rolling reservations allow both robots to travel along overlapping routes until a local conflict. The lower-priority robot can detour or yield to a holding point while the other passes. The coordination panel shows status, reserved tile counts and who is waiting on whom. Solid colored lines preview rack routes; dashed lines show each robot's live plan.
5. **Cancel / stop**, the drive Stop, and **Stop rack route** target the selected robot. Interrupting one member of a paired route also cancels its active peer. **Stop all** cancels both jobs and disarms manual input. Separation below 3.0 m (clears at 3.3 m) or stale fleet telemetry stops motion; resolve the cause and resubmit goals. There is no automatic restart after a safety stop.
6. Keep the tab visible. Each robot receives its own heartbeat every 250 ms while visible, including the unselected robot. Stale telemetry, lost connection or a hidden tab interrupts autonomy. Backend heartbeat, collision and command-timeout safeguards remain authoritative.

The offline dashboard still previews both robots and independent rack routes without ROS. Preview/stale labels distinguish fallback positions from live truth; dispatch requires fresh fleet readiness. Fleet mode does not change saved legacy SLAM checkpoints. See [map persistence](docs/MAP_PERSISTENCE.md) for that separate backend workflow.

## Rack routes, scan display and theme

Rack floor footprints are reserved storage space. The simulator blocks entry beneath shelving for both manual and autonomous movement, and both scan planes detect the full rack boundary. Routes must use the open aisles and go around rack ends.

The **Rack-to-rack path planning** panel selects a source and destination from the eight rack faces. A cyan route appears immediately in the warehouse and its small overhead map, even before ROS connects. Green marks the source and orange marks the destination. The preview uses the backend’s inflated static grid, any-angle shortcutting and collision-checked 0.65 m corner fillets. Safe pivot fallbacks remain where a fillet cannot fit. Live dense plans show the trajectory actually followed, including peer detours. Routes are near-optimal, rather than guaranteed globally shortest curvature-constrained paths. Its distance covers source to destination; the initial trip to the source is separate. Static warehouse geometry is used offline and received collision geometry is used when available.

**Start rack route** asks the fleet coordinator to visit the selected robot's source approach, then its destination after acknowledged source arrival. Both goals are sent directly in world coordinates. Live plans and reservation tiles use each robot's color. The coordinator may wait or replan around peers; an offline static preview cannot promise fleet feasibility. Stop, manual takeover, failure and stale telemetry interrupt the journey. Each robot retains its own source, destination and route progress when selection changes. Use **Start both** in Fleet coordination to submit both configured rack routes together. The dashboard explains readiness and rack conflicts. The coordinator admits both robots together and advances each to its destination when it reaches its source. **Stop all** stops both robots during either leg.

**LiDAR · 3D scan view** controls measured points and scan rays in the 3D scene. These are the existing planar scan at 1.02 m height, not a volumetric 3D sensor. Returns within 2 m turn red and show an **OBSTACLE** proximity warning; expected rack and wall surfaces also count. Live collision reports show the blocking object's type and ID. Stale scans are hidden and the UI reports sensing unavailable.

The header's **Dark mode** switch changes the entire dashboard theme. Dark is the default; an explicit light or dark choice is saved on this browser and synchronized between tabs. Blocked browser storage does not prevent switching themes.

Aisle-only rack routing: [policy and live validation](docs/RACK_AISLE_POLICY.md).

Historical live validation and localization-freshness details: [rack navigation verification](docs/history/LIVE_RACK_NAVIGATION.md) (single-robot mode, superseded by [fleet rolling validation](docs/FLEET_ROLLING_VALIDATION.md)).

## Gamepad controller

Connect a USB or Bluetooth controller, open localhost or HTTPS, and press any controller button so the browser can detect it. In **Drive AGV**, select **Enable gamepad driving**. Only browser `standard` mappings are accepted (common Xbox and PlayStation controllers).

- Left stick up/down: forward/reverse; left/right: turn. A 15% dead zone filters stick drift.
- Hold **RB / R1** to drive; release it to stop. Speed sliders set the maximum linear and angular speeds. Manual speed defaults to 0.7 m/s and can be raised to 1.2 m/s; fleet autonomous navigation is capped at 1.0 m/s by default. Set the fleet launch argument `autonomous_cruise_speed` to override the cap within the 1.2 m/s ceiling. Turning remains capped at 1.2 rad/s.
- **B / Circle**, the on-screen Stop, Space or Escape stop and disarm controller input.
- Center the stick and release RB/R1 before initial arming, after a stop, reconnect, focus loss or a polling interruption.
- Controller mode disables keyboard/directional-button driving to prevent conflicting publishers; the Stop button stays available. Disable controller mode to return to keyboard/buttons.
- Disconnecting the controller, losing browser focus/visibility or losing fresh robot telemetry stops controller commands. The backend command timeout and collision handling remain in effect. An enabled but idle controller does not repeatedly cancel Nav2.

The first standard-mapped connected controller is used. Custom joystick layouts and arbitrary button remapping are not included. API access follows the [browser Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getGamepads); localhost is supported for local development.

## ROS installation instead of Docker

Install ROS 2 Humble and dependencies using `rosdep install --from-paths ros2_ws/src --ignore-src -r -y`, source Humble, then:

```bash
cd ros2_ws
colcon build --packages-select agv_web_bridge --symlink-install
source install/setup.bash
ros2 launch agv_web_bridge agv_fleet.launch.py
```

`agv_fleet.launch.py` is the launch used by Docker Compose and the only mode the current dashboard drives. The **legacy single-robot modes** remain in the package for backend workflows: `agv_navigation.launch.py` (SLAM Toolbox + Nav2), `agv_mapping.launch.py` (mapping without Nav2) and `agv_simulation.launch.py` (manual simulation only). The dashboard cannot drive them. Run only one simulator at a time. All nodes use wall-clock time; no `/clock` publisher is required. See [MULTI_AGV.md](docs/MULTI_AGV.md) for the current ROS interfaces.

## Validate

The Docker acceptance suite uses a separate ROS domain so it cannot command the live robot:

```bash
rtk proxy docker run --rm -e ROS_DOMAIN_ID=71 -v "$PWD:/workspace" agv-warehouse:humble python3 -m unittest discover -s ros2_ws/src/agv_web_bridge/test -v
cd frontend
rtk npm test
rtk npm run build
rtk npm run test:e2e
```

The browser test requires the full ROS stack and installed Google Chrome (`channel: chrome`), and starts Vite if needed. It checks live fleet telemetry and connection recovery; run against a dedicated test session. Older phase reports referenced acceptance clients under `test_logs/` (for example `phase3_4_test_runner.py` and `end_to_end.py`); those files are no longer tracked. Evidence is generated locally into the gitignored `test_logs/` directory. The live fleet acceptance harness commands the Compose ROS domain, so run it separately from unit tests:

```bash
rtk proxy docker compose exec -T simulation bash -c 'source /opt/ros/humble/setup.bash; source /opt/agv_ws/install/setup.bash; python3 /workspace/scripts/fleet_concurrency_smoke.py'
```

Reports: [fleet rolling validation](docs/FLEET_ROLLING_VALIDATION.md), [multi-AGV design](docs/MULTI_AGV.md), [Phase 6 odometry](docs/PHASE_6_ODOMETRY.md), [Phase 7 mapping](docs/PHASE_7_SLAM.md). Historical single-robot reports are under [docs/history/](docs/history/).

The sensor model uses geometric approximations rather than mesh ray tracing, instantaneous scans rather than rotating acquisition, and configurable deterministic encoder calibration error rather than traction dynamics. This is a simulation project; exhaustive warehouse-wide route coverage and real hardware deployment are outside its acceptance scope.

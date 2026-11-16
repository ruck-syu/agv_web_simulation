# AGV Warehouse Simulation

A React/TypeScript/Three.js warehouse dashboard backed by a ROS 2 Humble differential-drive simulator, dual planar LiDAR, wheel odometry, SLAM Toolbox and Nav2. Phases 1–9 are integrated. The simulator owns physical motion and collision decisions; the browser displays received data and submits commands.

For migration to another machine or a handoff to another coding model, read [MODEL_SETUP_GUIDE.md](MODEL_SETUP_GUIDE.md).

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

## Operate

1. Use the live connection and navigation indicators to confirm readiness. Detailed System health is available under **Diagnostics & connection**. Startup takes several seconds.
2. Use the manual drive controls to explore known free aisles. Wheel odometry and physical warehouse truth are displayed separately. LiDAR returns and collision geometry can be toggled.
3. The SLAM map uses white free cells, dark occupied cells and gray unknown cells. Its red marker is the localized robot; a cyan line shows the current Nav2 plan. Goals use **map coordinates**, which can differ from warehouse coordinates.
4. Enter a goal in known free space and choose **Navigate to goal**. Nav2 plans with the full rectangular footprint and follows the path. Unknown goals are not assumed traversable. Cancel/stop and manual takeover interrupt autonomy.
5. Keep the tab visible while navigating. Missing heartbeat, stale sensors/localization or inactive Nav2 nodes stop autonomy. The simulator retains collision blocking and command timeout stopping.

The map is live SLAM output, not a map prefilled from the known scene. To save it:

```bash
rtk proxy docker compose exec simulation bash -c 'source /opt/ros/humble/setup.bash && ros2 run nav2_map_server map_saver_cli -f /workspace/warehouse_map'
```

## Rack routes, scan display and theme

Rack floor footprints are reserved storage space. The simulator blocks entry beneath shelving for both manual and autonomous movement, and both scan planes detect the full rack boundary. Routes must use the open aisles and go around rack ends.

The **Rack-to-rack path planning** panel selects a source and destination from the eight rack faces. A cyan route appears immediately in the warehouse and its small overhead map, even before ROS connects. Green marks the source and orange marks the destination. The preview finds the shortest visibility-graph route around conservative obstacle boxes expanded by the AGV turning radius plus 15 cm. Its distance covers source to destination; the initial trip to the source is separate. Static warehouse geometry is used offline and received collision geometry is used when available.

**Start rack route** asks Nav2 to visit the source approach point, then the destination approach point after confirmed source arrival. Goals are converted from warehouse to map coordinates using fresh wheel odometry, ground truth and map localization. Nav2's live plan appears in green and can differ from the cyan preview as SLAM discovers obstacles. Unknown map cells can prevent execution; the preview does not mark unknown space as safe. Stop, manual takeover, failure and stale telemetry interrupt the journey rather than advancing to the next rack.

**LiDAR · 3D scan view** controls measured points and scan rays in the 3D scene. These are the existing planar scan at 1.02 m height, not a volumetric 3D sensor. Returns within 2 m turn red and show an **OBSTACLE** proximity warning; expected rack and wall surfaces also count. Live collision reports show the blocking object's type and ID. Stale scans are hidden and the UI reports sensing unavailable.

The header's **Dark mode** switch changes the entire dashboard theme. Dark is the default; an explicit light or dark choice is saved on this browser and synchronized between tabs. Blocked browser storage does not prevent switching themes.

Aisle-only rack routing: [policy and live validation](docs/RACK_AISLE_POLICY.md).

Live validation and localization-freshness details: [rack navigation verification](docs/LIVE_RACK_NAVIGATION.md).

## Gamepad controller

Connect a USB or Bluetooth controller, open localhost or HTTPS, and press any controller button so the browser can detect it. In **Drive AGV**, select **Enable gamepad driving**. Only browser `standard` mappings are accepted (common Xbox and PlayStation controllers).

- Left stick up/down: forward/reverse; left/right: turn. A 15% dead zone filters stick drift.
- Hold **RB / R1** to drive; release it to stop. Speed sliders set the maximum linear and angular speeds. Manual speed defaults to 0.7 m/s and can be raised to 1.2 m/s; autonomous navigation is capped at 0.7 m/s. Turning remains capped at 1.2 rad/s.
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
ros2 launch agv_web_bridge agv_navigation.launch.py
```

Use `agv_mapping.launch.py` for mapping without Nav2, or `agv_simulation.launch.py` for manual simulation only. Run only one simulator at a time. All nodes use wall-clock time; no `/clock` publisher is required. See the phase reports for wheel-error experiments and ROS interfaces.

## Validate

The Docker acceptance suite uses a separate ROS domain so it cannot command the live robot:

```bash
rtk proxy docker run --rm -e ROS_DOMAIN_ID=71 -v "$PWD:/workspace" agv-warehouse:humble python3 -m unittest discover -s ros2_ws/src/agv_web_bridge/test -v
rtk proxy docker run --rm -e ROS_DOMAIN_ID=73 -v "$PWD:/workspace" agv-warehouse:humble python3 test_logs/phase3_4_test_runner.py
cd frontend
rtk npm test
rtk npm run build
rtk npm run test:e2e
```

The browser test requires the full ROS stack and installed Google Chrome (`channel: chrome`), and starts Vite if needed. It sends a short real Nav2 goal and cancels it; run against a dedicated test session, not during another operator's navigation. The ROS end-to-end acceptance client also controls the live stack, so run it separately:

```bash
rtk proxy docker compose exec -T simulation bash -c 'source /opt/ros/humble/setup.bash && source /opt/agv_ws/install/setup.bash && python3 /workspace/test_logs/end_to_end.py'
```

Reports: [final validation](docs/FINAL_VALIDATION.md), [Phase 6 odometry](docs/PHASE_6_ODOMETRY.md), [Phase 7 mapping](docs/PHASE_7_SLAM.md), [Phase 8 navigation](docs/PHASE_8_NAVIGATION.md), [Luna reviews](docs/CODE_REVIEWS.md).

The sensor model uses geometric approximations rather than mesh ray tracing, instantaneous scans rather than rotating acquisition, and configurable deterministic encoder calibration error rather than traction dynamics. This is a simulation project; exhaustive warehouse-wide route coverage and real hardware deployment are outside its acceptance scope.

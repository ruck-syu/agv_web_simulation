# AGV Warehouse Simulation — setup guide for coding models

This file is a handoff to another model or coding agent setting up this project on a different machine. Read it before installing dependencies or starting services.

**Recommended route:** run ROS 2 in Docker and the frontend on the host. Native ROS instructions are provided for Ubuntu 22.04. Do not treat historical test reports as proof that the new machine works.

## 1. Instructions for the receiving model

1. Locate the project root; do not assume a particular username, home directory, checkout path, or Git remote.
2. Read any applicable `AGENTS.md` and local agent instructions. Personal paths mentioned by the previous agent may not exist on this system.
3. Inspect the current files before acting: `Dockerfile`, `docker-compose.yml`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts`, and `ros2_ws/src/agv_web_bridge/package.xml`.
4. Identify OS, CPU architecture, available shell, Node version, Docker daemon availability, and existing listeners on the project ports.
5. Preserve source edits, saved maps, and user configuration. Reinstall generated dependencies for the new OS/architecture; never reuse another machine's `node_modules` or ROS install tree.
6. Use the existing lockfile and Humble distribution. Do not upgrade frameworks, rewrite the simulation, substitute another ROS distribution, or fabricate a static map just to make setup pass.
7. Start one simulator, verify actual topic data, then run the relevant checks. Report unavailable checks as unavailable or skipped, not passed.
8. At handoff, give the local URL, running services, commands to stop them, test results, and any remaining limitation.

Commands below use ordinary `docker`, `npm`, and shell commands so this guide does not require RTK. On a machine whose agent instructions require RTK, adapt them with `rtk proxy <command>` or the appropriate supported RTK command. Do not require the previous owner's personal RTK installation on another machine.

## 2. What this project runs

| Component | Runtime/location | Purpose |
| --- | --- | --- |
| React + TypeScript + Vite | Host, `frontend/` | Control desk, live warehouse rendering, gamepad and navigation UI |
| Three.js / React Three Fiber | Browser with WebGL | Industrial warehouse scene and robot visualization |
| Authoritative simulator | ROS 2 Humble, Python | Differential drive, accepted wheel motion, collisions, sensor simulation |
| Navigation bridge | ROS 2 Humble, Python | Command ownership, Nav2 action client, stop/freshness behavior |
| SLAM Toolbox | ROS container/native Humble | Occupancy map and `map → odom` |
| Nav2 | ROS container/native Humble | Planning, local control, obstacle avoidance and goal lifecycle |
| rosbridge | ROS container/native Humble | Browser WebSocket transport |

The frontend is **not** a service in the supplied Compose file. Running `docker compose up` alone does not start the website.

### Files to transfer

Copy or check out the actual source tree, including:

```text
Dockerfile
.dockerignore
docker-compose.yml
README.md
MODEL_SETUP_GUIDE.md
frontend/package.json
frontend/package-lock.json
frontend/index.html
frontend/tsconfig.json
frontend/vite.config.ts
frontend/playwright.config.ts
frontend/.env.example
frontend/src/
frontend/public/
frontend/tests/
frontend/e2e/
ros2_ws/src/
test_logs/*.py
docs/
```

`test_logs/` contains executable acceptance clients as well as generated reports. Keep its Python files. Keep saved `.pgm`/`.yaml` maps together if the user wants to retain them.

Do not transfer or rely on generated directories:

```text
frontend/node_modules/
frontend/dist/
frontend/test-results/
frontend/playwright-report/
ros2_ws/build/
ros2_ws/install/
ros2_ws/log/
**/__pycache__/
```

If they arrived in a copied folder, rebuild/reinstall them. This project has previously been supplied as a directory without `.git`; do not invent a clone URL or assume version-control commands will work.

## 3. Prerequisites and platform choice

Use **Node.js 26.x** to match the verified project environment. This also supplies native TypeScript type stripping used when the frontend's `.mjs` tests import `.ts` helpers. An older Node release may run Vite but still fail the test command. Use the lockfile's npm dependencies rather than selecting new package versions. See the [Node TypeScript runtime documentation](https://nodejs.org/api/typescript.html).

Use a current Chrome-family browser with WebGL. The existing Playwright configuration specifically selects installed **Google Chrome** with `channel: 'chrome'`; installing only Playwright's bundled Chromium does not satisfy that configuration. See [Playwright browser installation](https://playwright.dev/docs/browsers).

| Host | Setup route |
| --- | --- |
| macOS, Apple Silicon | Docker Desktop for Apple Silicon; Linux ARM64 ROS container; host Node/frontend |
| macOS, Intel | Docker Desktop for Intel; Linux AMD64 ROS container; host Node/frontend |
| Windows x64 | Docker Desktop using Linux containers; PowerShell frontend, or a consistent WSL workspace |
| Ubuntu 22.04 x86_64/ARM64 | Docker Engine + Compose plugin, or native Humble |
| Other supported Linux host | Prefer Docker with the supplied Humble image |
| Windows ARM64 or other architectures | Check actual Docker image/browser availability; these targets have not been validated by this project |

The original verified environment was macOS ARM64, Node 26, Docker Desktop with Linux ARM64, and Google Chrome. The other routes are setup instructions, not claims that those machines have already passed acceptance.

Install Docker through the appropriate official instructions: [macOS](https://docs.docker.com/desktop/setup/install/mac-install/), [Windows](https://docs.docker.com/desktop/setup/install/windows-install/), or [Docker Engine](https://docs.docker.com/engine/install/). Docker Desktop includes Compose; Linux Engine installations need the [Compose plugin](https://docs.docker.com/compose/install/). On Windows, select the Linux-container backend and configure WSL integration if using a WSL shell. Keep Node, npm, and `node_modules` inside the same Windows or WSL environment; do not mix their binaries.

## 4. Inspect the destination machine

Run these from the project root after installing prerequisites:

```bash
node --version
npm --version
docker version
docker info
docker compose version
docker compose config --quiet
```

`docker version` must show a working server, not merely a CLI installation. Start Docker Desktop or the Docker daemon if the server is unavailable. Fix daemon access using the host's supported installation procedure; do not blindly add privilege flags to project containers.

### Ports and endpoints

| Port | Service | Current configuration |
| --- | --- | --- |
| `3000` | Vite development UI | `http://127.0.0.1:3000` |
| `9090` | rosbridge | Compose publishes `127.0.0.1:9090`; local browser defaults to `ws://localhost:9090` |
| `4174` | Production preview UI | `http://127.0.0.1:4174`; `/rosbridge` proxies to host port 9090 |

Both Vite servers use `strictPort`. A busy port is an error, not an automatic move to another port. Inspect listeners before changing configuration; do not kill an unrelated process.

Examples: macOS `lsof -nP -iTCP:3000 -sTCP:LISTEN`; Linux `ss -ltnp`; PowerShell `Get-NetTCPConnection -State Listen -LocalPort 3000,9090,4174` (a missing listener may produce no result/error).

## 5. Recommended setup: Docker ROS + host frontend

### Terminal A: backend, from the project root

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail 100 simulation
```

The image starts from `ros:humble-ros-base`, installs rosbridge, SLAM Toolbox and Nav2, copies `ros2_ws/src`, and runs `colcon build`. It launches `agv_navigation.launch.py`, which includes the simulator, navigation bridge, rosbridge, SLAM and Nav2 lifecycle-managed nodes.

The first build needs network access to Docker Hub, Ubuntu and ROS package repositories. Docker chooses a compatible image architecture; do not force `linux/amd64` on Apple Silicon without a demonstrated dependency need.

Compose uses `ROS_DOMAIN_ID=72`, image name `agv-warehouse:humble`, and a workspace bind mount at `/workspace`. ROS source actually executed by the service is built into `/opt/agv_ws`, **not** read live from the bind mount. Rebuild/recreate after modifying ROS source, launch files or YAML:

```bash
docker compose up -d --build
```

Do not overwrite the image's install directory with copied host `ros2_ws/install` files.

### Terminal B: frontend

From the root:

```bash
cd frontend
npm ci
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:3000`. Leave this process running.

For normal local operation, no `.env` file is required. If a copied `.env`, `.env.local`, shell variable, or production build references an old tunnel/server, remove that stale endpoint from the local configuration or set it explicitly to the current endpoint. Inspect configuration before overwriting user-specific values.

Optional local override, Bash/zsh:

```bash
VITE_ROSBRIDGE_URL=ws://localhost:9090 npm run dev -- --host 127.0.0.1
```

PowerShell:

```powershell
$env:VITE_ROSBRIDGE_URL = 'ws://localhost:9090'
npm run dev -- --host 127.0.0.1
```

Vite environment values are build/start-time values. Restart dev after changing environment files; rebuild `dist` to change a production endpoint.

### Confirm actual readiness

1. Header shows the bridge connection and fresh robot telemetry.
2. Drive controls and the live warehouse render.
3. LiDAR updates, `/odom` estimates arrive, and the SLAM occupancy map appears.
4. Open **Diagnostics & connection** for detailed System health and connection information. Diagnostics are intentionally collapsed on the redesigned UI.
5. Navigation becomes available only when Nav2 nodes are active and map/localization, sensor data and operator heartbeat are fresh.

Allow the stack time to initialize. Software WebGL may take longer to warm up in headless tests. Do not infer readiness from container status alone.

### Windows notes

The startup commands above work in PowerShell after changing into the project folder; do not use Bash `source`, `export`, or backslash continuations directly in PowerShell. The Bash commands passed to `docker compose exec ... bash -c '...'` run **inside Linux**, so the inner ROS paths are correct on Windows too.

If using WSL, use a consistent Linux workspace and install/run Node in WSL. If using PowerShell, install/run Windows Node and let `npm ci` install Windows dependencies. If switching environments, reinstall `node_modules` for that environment. If Playwright runs inside WSL, it needs a compatible Linux Chrome installation there; a Windows Chrome installation does not automatically satisfy a Linux `channel: chrome` lookup. Verify WSL localhost forwarding if the Windows browser cannot reach a server started in WSL.

## 6. Native Ubuntu 22.04 alternative

Use this only on a compatible Ubuntu 22.04 system. Follow the [official Humble Debian package installation instructions](https://docs.ros.org/en/humble/Installation/Ubuntu-Install-Debs.html) to configure the ROS apt repository and install Humble first. Do not install Jammy/Humble apt packages directly into a different Ubuntu release or macOS.

After the ROS repository is configured:

```bash
sudo apt-get update
sudo apt-get install -y ros-humble-ros-base ros-humble-rosbridge-server ros-humble-slam-toolbox ros-humble-navigation2 ros-humble-nav2-bringup python3-colcon-common-extensions python3-rosdep python3-pytest python3-numpy python3-yaml
source /opt/ros/humble/setup.bash
```

Initialize rosdep once if this machine has never initialized it:

```bash
sudo rosdep init
rosdep update
```

If rosdep is already initialized, skip `rosdep init`; do not replace its existing configuration. From the project root, install declared dependencies and build with the system Python compatible with Humble:

```bash
rosdep install --from-paths ros2_ws/src --ignore-src --rosdistro humble -r -y
cd ros2_ws
colcon build --packages-select agv_web_bridge --symlink-install
source install/setup.bash
export ROS_DOMAIN_ID=72
ros2 launch agv_web_bridge agv_navigation.launch.py
```

Start the frontend in another terminal as in section 5. In **every** additional ROS terminal, source Humble and this workspace's `install/setup.bash` and set `ROS_DOMAIN_ID=72` before inspecting topics.

Do not source a copied install tree or use an unrelated Conda/virtualenv Python for ROS. Verify `python3 -c 'import rclpy, numpy, yaml'` succeeds in the sourced environment. NumPy accelerates the LiDAR calculations; missing acceleration can affect simulation/timer responsiveness.

Do not run native ROS and the Compose simulator simultaneously on the same bridge port/domain.

### Launch choices

| Launch file | Starts |
| --- | --- |
| `agv_navigation.launch.py` | Complete simulation + bridge + SLAM + Nav2 |
| `agv_mapping.launch.py` | Simulation + bridge + SLAM, without Nav2 |
| `agv_simulation.launch.py` | Simulator + command/action bridge + rosbridge, without SLAM/Nav2 servers |

All nodes use **wall-clock time** (`use_sim_time=false`); this simulator does not require a `/clock` publisher. Mapping/navigation launches include the simulation launch. Never start another simulator to supplement them.

## 7. Validation sequence

Do not reuse old reports to claim the new machine passed. These commands generate new evidence.

### A. Frontend unit tests and production build

From `frontend/`:

```bash
npm test
npm run build
```

The current suite contains 20 frontend tests. Counts can change with later source updates; inspect the actual result. A build pass includes TypeScript checking. It does not prove ROS or rendering works.

For Windows, if an older Node/shell cannot resolve the test glob, use Node 26 and/or pass the `.test.mjs` filenames explicitly. Do not remove tests or convert TypeScript files merely to accommodate an old runtime.

### B. Isolated ROS unit/binding tests

Bash/zsh, from the root:

```bash
docker run --rm -e ROS_DOMAIN_ID=71 -v "$PWD:/workspace" agv-warehouse:humble python3 -m unittest discover -s ros2_ws/src/agv_web_bridge/test -v
```

PowerShell:

```powershell
docker run --rm -e ROS_DOMAIN_ID=71 --mount "type=bind,source=$($PWD.Path),target=/workspace" agv-warehouse:humble python3 -m unittest discover -s ros2_ws/src/agv_web_bridge/test -v
```

The current full backend suite has 42 tests. ROS tests skipped because `rclpy` is absent on a host are not acceptance passes; running them in the image supplies real ROS. Domain 71 isolates the test driver from the operator stack on domain 72.

### C. Motion/collision acceptance

Bash/zsh:

```bash
docker run --rm -e ROS_DOMAIN_ID=73 -v "$PWD:/workspace" agv-warehouse:humble python3 test_logs/phase3_4_test_runner.py
```

PowerShell: use the same `--mount "type=bind,source=$($PWD.Path),target=/workspace"` form from B, domain 73, and the `python3 test_logs/phase3_4_test_runner.py` command.

This runs 18 movement, collision, timeout, aisle and under-rack scenarios. Results are written under `test_logs/`. Tests start their own simulation; do not also start a navigation bridge that publishes zeros in the test domain.

### D. Inspect the live stack

Each container exec starts a new shell; source the environments explicitly:

```bash
docker compose exec -T simulation bash -c 'source /opt/ros/humble/setup.bash && source /opt/agv_ws/install/setup.bash && ros2 topic list'
docker compose exec -T simulation bash -c 'source /opt/ros/humble/setup.bash && ros2 topic echo /agv_web/navigation_status --once'
docker compose exec -T simulation bash -c 'source /opt/ros/humble/setup.bash && ros2 topic hz /scan'
```

`ros2 topic hz` runs until interrupted. Typical configured rates are 10 Hz per LiDAR and 25 Hz odometry, subject to host scheduling. A stale/missing stream must be investigated rather than replaced with generated UI data.

### E. Browser acceptance

Install Google Chrome on the machine that will run Playwright. Then, from `frontend/` with the full stack available at localhost:9090:

```bash
npm run test:e2e
```

The configuration starts/reuses Vite on port 3000. An already-running Vite instance must use the **local** ROS endpoint expected by the tests. Do not point acceptance at a public preview build or unrelated dev server. Existing tests are sequential (`workers: 1`) and allow software WebGL initialization time.

There are currently two browser cases: virtual-controller safety checks using a mocked connection, and a real ROS dashboard case that submits/cancels a Nav2 goal and checks reconnection. Keep the actual stack available for the latter. If the browser channel is unavailable, install the configured browser or explicitly adapt the configuration and report the change; do not silently report a different browser as Chrome.

### F. Real SLAM/Nav2 acceptance client

Run this separately from browser tests and operator use; it commands the live robot:

```bash
docker compose exec -T simulation bash -c 'source /opt/ros/humble/setup.bash && source /opt/agv_ws/install/setup.bash && python3 /workspace/test_logs/end_to_end.py'
```

It checks live scans/map/TF, navigation arrival, cancellation and heartbeat stopping. Its report path is hard-coded to `/workspace/test_logs/end_to_end_results.json`, which is supplied by the Compose mount. For native Ubuntu, use the individual checks/browser suite or deliberately adapt that output path; do not assume `/workspace` exists on the host. The motion runner and backend suite can run natively in a sourced Humble environment with isolated `ROS_DOMAIN_ID` values.

Do not run browser navigation, the live acceptance client and another operator's drive session concurrently. They share command ownership and can cancel one another.

## 8. Interfaces the receiving model must preserve

| Interface | Meaning |
| --- | --- |
| `/agv_web/manual_cmd_vel` | Browser keyboard, buttons and controller input |
| `/agv_web/nav_cmd_vel` | Nav2 controller/behavior output |
| `/cmd_vel` | Selected command from the bridge; consumed by the simulator |
| `/odom` | Wheel-integrated pose estimate, header `odom`, child `base_link` |
| `/agv_web/ground_truth` | Physical world pose for the warehouse model/camera |
| `/scan` | Roof LiDAR used by SLAM and costmaps |
| `/scan_obstacles` | Floor-level obstacle scan used by navigation |
| `/map` | Real SLAM occupancy grid |
| `/tf`, `/tf_static` | `map → odom → base_link → laser_frame` plus the floor sensor frame |
| `/agv_web/navigation_command` | JSON goal/cancel/stop requests inside a String message |
| `/agv_web/navigation_status` | Action, lifecycle, localization, sensor and operator readiness |

Only the bridge should own `/cmd_vel` during normal operation. Do not add another velocity publisher, duplicate TF parent, static identity `map → odom` or ground-truth shortcut to make Nav2 appear healthy.

Keep the website tab visible for autonomous navigation. Operator heartbeat, sensor/localization freshness, manual priority, backend timeout and collision stopping are part of the design. Gamepad mode additionally requires focus, standard mapping, neutral/released arming, and RB/R1 hold-to-drive.

## 9. Production preview and another computer's browser

From `frontend/`, local preview is:

```bash
npm run build
npm run preview
```

Open `http://127.0.0.1:4174`. This serves a static frontend build; it still needs the live ROS backend. Vite preview is for previewing the build, not a production deployment platform.

For a browser on another computer, `localhost:9090` refers to **that computer**, not the simulator host. The ROS endpoint must be reachable from the visiting browser. An HTTPS website must use a secure `wss://` endpoint to avoid mixed-content blocking.

The preview server already proxies `/rosbridge` to host port 9090. For an explicitly requested TryCloudflare preview, start a fresh tunnel to port 4174, get **its new hostname**, and rebuild the frontend with that hostname's secure `/rosbridge` endpoint. Do not reuse the previous machine's temporary URL from `docs/PREVIEW.md`.

Example with cloudflared installed on the host:

```bash
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4174 --http-host-header localhost:4174
```

After reading the actual printed hostname, in a separate terminal (replace `YOUR-NEW-HOST`):

```bash
cd frontend
VITE_ROSBRIDGE_URL=wss://YOUR-NEW-HOST.trycloudflare.com/rosbridge npm run build
npm run preview
```

PowerShell uses `$env:VITE_ROSBRIDGE_URL = 'wss://YOUR-NEW-HOST.trycloudflare.com/rosbridge'` before `npm run build` instead of the Bash inline assignment.

For a preview that survives a terminal closing, this repository also supplies an optional Nginx service. Build `frontend/dist` first, stop any Vite preview using port 4174, then run `docker compose --profile preview up -d --no-build preview` from the project root. It serves the same port and proxies `/rosbridge` to `simulation:9090`. A cloudflared container on the Compose network can target `http://preview:80` directly; see `docs/PREVIEW.md` for the current setup. Use `--protocol http2` if QUIC connections time out. This preview service does not start with the default Compose profile.

If cloudflared runs in Docker while Vite runs on the host, the target must point to the **host's** preview service, not container localhost. Docker Desktop supplies `host.docker.internal`; plain Linux Engine may require `--add-host=host.docker.internal:host-gateway`. Keep the Host header override aligned to `localhost:4174`. Consult the [Cloudflare Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) and inspect actual network reachability.

Keep the preview process, tunnel, Docker daemon and simulator alive. Verify both HTTPS page loading and actual ROS WebSocket messages before handing over a link. A public preview exposes the controls provided by the app; create it only within the user's requested sharing scope.

A normal local build must not retain a stale `VITE_ROSBRIDGE_URL`. Remove the environment override and rebuild when returning to local use. For PowerShell, clear a session override with `Remove-Item Env:VITE_ROSBRIDGE_URL` if it exists; also inspect `.env*` files.

## 10. Troubleshooting

| Symptom | Check/fix |
| --- | --- |
| Docker CLI exists but cannot connect | Start Desktop/daemon; verify `docker info` succeeds. |
| `npm ci` fails after a folder was copied | Reinstall for the actual host architecture. Preserve the lockfile; do not reuse Linux binaries on macOS/Windows. |
| `Permission denied` for `tsc` or native module errors | Treat copied `node_modules` as generated artifacts; regenerate with `npm ci` on the destination. |
| TypeScript imports fail under `npm test` | Check Node, not just Vite. Use the documented Node 26 baseline. |
| Old footprint/limits/code despite editing source | Rebuild/recreate the Docker image, or rebuild and source the correct native install. |
| UI connected, no topics in an external ROS shell | Check ROS domain 72 and both sourced setup files; container exec inherits domain but needs sourcing. |
| Nav2 goal button unavailable | Inspect lifecycle states, fresh `/map`, `map → odom`, `/odom`, floor scan and operator heartbeat; keep the tab visible. |
| Map is empty / navigation fails in unknown space | Explore manually; this project does not prefill a map from warehouse geometry. |
| Robot stops unexpectedly during a test | Check whether another browser/test/manual publisher is taking priority or canceling the goal. |
| Slow or black 3D viewport | Check WebGL/GPU support and browser console. Test software rendering separately from ROS readiness; avoid reducing safety behavior to hide slow rendering. |
| Preview page loads, robot is offline | Check the built WebSocket endpoint and `/rosbridge` proxy. Remote `localhost` and HTTPS-to-`ws://` are common mistakes. |
| Preview HTTP works but WebSocket returns 404 | Check which process owns the exact interface/port. A different loopback server can answer while a wildcard listener serves other interfaces. Verify the intended Vite preview server and proxy. |
| Test reports claim skipped ROS tests | Run the backend suite inside the built image or a sourced native Humble environment; do not count skips as passes. |

## 11. Stop, save and hand off

Stop frontend/preview processes in their own terminals with Ctrl+C. Stop the ROS service with:

```bash
docker compose down
```

If a map must be retained, save it **before** stopping/recreating the simulator:

```bash
docker compose exec -T simulation bash -c 'source /opt/ros/humble/setup.bash && ros2 run nav2_map_server map_saver_cli -f /workspace/warehouse_map'
```

Keep both generated map files. Saving a map does not automatically configure this mapping launch to reload it on startup. Do not claim session state survives a restart unless you have implemented and verified that behavior.

End the receiving model's setup task with:

- Destination OS/architecture and chosen setup route.
- Actual website URL and ROS endpoint.
- Running services and stop commands.
- Fresh frontend/backend/browser/live acceptance results, distinguishing unavailable checks.
- Necessary configuration differences and any known limitation.

A suitable instruction to give the next model is:

> Read `MODEL_SETUP_GUIDE.md`, inspect this machine and the current project files, then set up the AGV Warehouse Simulation using the recommended Docker route unless the host is a suitable native Humble system. Preserve source/configuration and the command/TF safety contracts. Reinstall generated dependencies for this platform, verify actual ROS data and the website, and report only checks you actually ran. Do not create a public tunnel unless I request one.

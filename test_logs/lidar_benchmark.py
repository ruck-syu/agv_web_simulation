import json
import statistics
import sys
import time
from pathlib import Path
sys.path.insert(0, '/workspace/ros2_ws/src/agv_web_bridge')
from agv_web_bridge.simulation_node import SimulationNode
from agv_web_bridge.lidar import scan_ranges
config = json.loads(Path('/workspace/ros2_ws/src/agv_web_bridge/config/warehouse_collision.json').read_text())
obstacles = SimulationNode._build_obstacles(config)
measurements = []
for _ in range(100):
    start = time.perf_counter()
    scan_ranges(obstacles, -2.8, 1.6, 0)
    scan_ranges(obstacles, -2.8, 1.6, 0, height=0.02)
    measurements.append((time.perf_counter() - start) * 1000)
result = {'obstacles': len(obstacles), 'rays_per_sensor': 360, 'sensors': 2,
          'mean_ms': statistics.mean(measurements), 'p95_ms': sorted(measurements)[94]}
Path('/workspace/test_logs/lidar_benchmark.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))

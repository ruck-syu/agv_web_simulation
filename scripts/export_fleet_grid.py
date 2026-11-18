"""Run in the built ROS image to refresh frontend's authoritative static grid.

python3 /workspace/scripts/export_fleet_grid.py > frontend/src/navigation/fleetGrid.json
Run backend/frontend parity tests after geometry or planner changes.
"""
import json
import sys
from pathlib import Path
from agv_web_bridge.fleet import GridPlanner
from agv_web_bridge.simulation_node import SimulationNode
planner=GridPlanner(SimulationNode._build_obstacles(SimulationNode._load_config(SimulationNode._default_config_path())))
if '--fixtures' in sys.argv:
    pairs=[((-2.8,1.6),(8,1.6)),((-12,2.28),(-12,9.88)),
           ((-12,9.88),(-12,-5.32)),((4.5,1.6),(4.5,-5)),
           ((-2.875,1.625),(7.125,1.875))]
    print(json.dumps([dict(start=a,end=b,path=planner.route(a,b)) for a,b in pairs]))
    sys.exit(0)
rows=[]
for y in range(-76,77):
    runs=[]
    for x in sorted(x for x,j in planner.blocked if j==y and -124<=x<=124):
        if runs and runs[-1][1]==x-1:
            runs[-1][1]=x
        else:
            runs.append([x,x])
    rows.append([y,runs])
data=dict(resolution=planner.resolution,bounds=planner.bounds,rows=rows)
if '--check' in sys.argv:
    actual=json.loads(Path(__file__).resolve().parents[1].joinpath('frontend/src/navigation/fleetGrid.json').read_text())
    assert json.loads(json.dumps(data))==actual, 'fleetGrid.json drift: re-export backend grid'
else:
    print(json.dumps(data,separators=(',',':')))


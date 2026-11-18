# Read-only fuzz of the pure FleetCoordinator (no ROS, no repo writes). Ideal kinematic plant.
import math, random, sys, collections, time
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))
from agv_web_bridge.fleet import GridPlanner
from agv_web_bridge.fleet_coordinator import FleetCoordinator

class Ob:
    def __init__(s, cx, cy, hx, hy, yaw=0.0):
        s.cx, s.cy, s.hx, s.hy, s.yaw = cx, cy, hx, hy, yaw
        s.shape, s.min_z, s.max_z = "box", 0.0, 2.0

def scenario(seed, n_ticks=2200):
    rnd = random.Random(seed)
    obs = []
    for _ in range(rnd.randint(0, 4)):
        obs.append(Ob(rnd.uniform(-8, 8), rnd.uniform(-8, 8), rnd.uniform(0.5, 3), rnd.uniform(0.5, 1.5)))
    planner = GridPlanner(obs, bounds=(-12, 12, -12, 12))
    def free_pt():
        for _ in range(500):
            p = (rnd.uniform(-10, 10), rnd.uniform(-10, 10))
            if planner.cell(p) not in planner.blocked and all(math.dist(p, (q.cx, q.cy)) > 3 for q in []):
                return p
        return None
    starts = [free_pt(), free_pt()]
    if None in starts or math.dist(*starts) < 3.3: return None
    clock = {"t": 100.0}
    core = FleetCoordinator(planner, lambda: clock["t"])
    out = {}
    core.publish_velocity = lambda rid, v: out.update({rid: v})
    core.publish_plan = lambda r: None
    core.publish_state = lambda s: None
    for rid, p in zip(("agv1", "agv2"), starts):
        core.robots[rid]["pose"] = (p[0], p[1], rnd.uniform(-math.pi, math.pi))
    goals = [free_pt(), free_pt()]
    if None in goals: return None
    delay = [0.0, rnd.uniform(0, 3)]
    pending = {"agv1": goals[0], "agv2": goals[1]}
    stats = dict(min_sep=100.0, max_t=0.0, seed=seed, safety=0, done=None)
    def refresh():
        for r in core.robots.values():
            r["truth_time"] = clock["t"]; c = r["control"]
            c.odom_time = c.scan_time = c.heartbeat_time = clock["t"]
    refresh()
    t0 = clock["t"]
    for k in range(n_ticks):
        if k == 0 or (delay[1] and clock["t"] - t0 >= delay[1] and "agv2" in pending):
            for rid in list(pending):
                g = pending.pop(rid)
                core.command(rid, dict(action="goal", x=g[0], y=g[1], yaw=0.0))
            if not pending: pass
        clock["t"] += 0.1; refresh()
        st = core.tick()
        stats["safety"] += st["safety_stop"]
        sep = st["separation_m"]
        if sep is not None: stats["min_sep"] = min(stats["min_sep"], sep)
        for rid, r in core.robots.items():
            v, w = out.get(rid, (0.0, 0.0))
            x, y, th = r["pose"]
            r["pose"] = (x + v*math.cos(th)*0.1, y + v*math.sin(th)*0.1, th + w*0.1)
        states = [core.robots[i]["state"] for i in ("agv1", "agv2")]
        if all(s in ("succeeded", "failed", "canceled", "safety_stop", "unavailable") for s in states) and not pending:
            stats["done"] = tuple(states); break
    stats["final"] = {rid: (r["state"], r["detail"]) for rid, r in core.robots.items()}
    stats["t"] = clock["t"] - t0
    stats["core"] = core
    return stats

if __name__ == "__main__":
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    start = time.time()
    tally = collections.Counter(); worst = []; stuck = []
    for seed in range(N):
        s = scenario(seed)
        if s is None: tally["skipped"] += 1; continue
        tally["run"] += 1
        fin = tuple(v[0] for v in s["final"].values())
        tally[fin] += 1
        if s["min_sep"] < 3.0: tally["sep<3.0 runs"] += 1
        if s["min_sep"] < 2.0: worst.append((s["min_sep"], seed))
        if any(v[0] not in ("succeeded",) for v in s["final"].values()) : stuck.append((seed, round(s["t"],1), s["final"]))
    print("runs", tally["run"], "skipped", tally["skipped"], "elapsed %.1fs" % (time.time()-start))
    for k, v in tally.most_common():
        if k not in ("run", "skipped"): print("  ", k, v)
    print("min-sep < 2.0 m:", sorted(worst)[:10])
    print("non-success outcomes (all):")
    for row in stuck: print("  ", row)

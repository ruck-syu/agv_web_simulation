"""Compare two cruise settings with the same simulator-rate controller."""
import json
import math
from pathlib import Path
import statistics
import sys
import unittest

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agv_web_bridge import fleet, motion_limits
from agv_web_bridge.fleet_coordinator import FleetCoordinator
from agv_web_bridge.odometry import integrate_pose

SCENARIOS = {
    'head_on': (((-2.8, 1.6, 0.), (4.5, 1.6, 0.)), ((8., 1.6, 0.), (-5., 1.6, math.pi))),
    'crossing': (((-5., 1.6, 0.), (5., -5., math.pi / 2)), ((10., 1.6, 0.), (5., 8., math.pi / 2))),
    'long_corner': (((15., 1.6, math.pi), (16., 10.5, 0.)), ((-12., -6.68, -math.pi / 2), (25., 10.5, 0.))),
}


def warehouse():
    data = json.loads((ROOT / 'frontend/src/navigation/fleetGrid.json').read_text())
    planner = fleet.GridPlanner([], bounds=data['bounds'], resolution=data['resolution'])
    planner.blocked = {(x, y) for y, spans in data['rows'] for a, b in spans for x in range(a, b + 1)}
    return planner


def segment_distance(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    norm = dx * dx + dy * dy
    t = max(0., min(1., ((point[0]-a[0])*dx + (point[1]-a[1])*dy)/norm)) if norm else 0.
    return math.hypot(point[0]-a[0]-t*dx, point[1]-a[1]-t*dy)


def simulate(starts, goals, phase, cruise=fleet.AUTONOMOUS_CRUISE_SPEED):
    planner = warehouse()
    now = 100.
    coordinator = FleetCoordinator(planner, lambda: now, cruise=cruise)
    poses = dict(zip(coordinator.robots, starts))
    targets = dict(zip(coordinator.robots, goals))
    velocities = {rid: (0., 0.) for rid in poses}
    commands = velocities.copy()
    plans, terminal = {}, {}
    metrics = {rid: dict(cross_track=0., peak_speed=0., overshoot=0., intrusion=0) for rid in poses}
    coordinator.publish_velocity = lambda rid, cmd: commands.update({rid: cmd})
    coordinator.publish_plan = lambda r: plans.update({r['robot_id']: tuple(r['path'])}) if r['path'] else None
    for rid, r in coordinator.robots.items():
        r['robot_id'] = rid
        r['pose'] = poses[rid]
        r['truth_time'] = now
        c = r['control']
        c.scan_time = c.odom_time = c.heartbeat_time = now
    for rid, (x, y, yaw) in targets.items():
        coordinator.command(rid, dict(action='goal', x=x, y=y, yaw=yaw))
    minimum = math.inf
    for step in range(9100):
        now = 100. + step * .02
        if step % 2 == 0:
            for rid, r in coordinator.robots.items():
                r.update(pose=poses[rid], velocity=velocities[rid], truth_time=now)
                c = r['control']
                c.scan_time = c.odom_time = c.heartbeat_time = now
        if step % 5 == phase:
            st = coordinator.tick()
            for rid, r in st['robots'].items():
                if not r['busy']:
                    terminal.setdefault(rid, (r['state'], now - 100.))
        for rid, pose in poses.items():
            target = targets[rid]
            v, w = velocities[rid]
            cv, cw = commands[rid]
            dv = getattr(motion_limits, 'SIM_LINEAR_ACCELERATION', 1.2) * .02
            dw = getattr(motion_limits, 'SIM_ANGULAR_ACCELERATION', 2.5) * .02
            v += max(-dv, min(dv, cv-v))
            w += max(-dw, min(dw, cw-w))
            maximum_wheel_speed = .19 * motion_limits.MAX_WHEEL_ANGULAR_SPEED
            left = max(-maximum_wheel_speed, min(maximum_wheel_speed, v - w * .47))
            right = max(-maximum_wheel_speed, min(maximum_wheel_speed, v + w * .47))
            velocities[rid] = ((left + right) / 2, (right - left) / .94)
            p = poses[rid] = integrate_pose(*pose, left * .02, right * .02, .94)
            m = metrics[rid]
            m['peak_speed'] = max(m['peak_speed'], v)
            m['intrusion'] += not planner.clear(pose, p)
            path = plans.get(rid, ())
            if len(path) > 1:
                offset = min(segment_distance(p, a, b) for a, b in zip(path, path[1:]))
                m['cross_track'] = max(m['cross_track'], offset)
                if math.dist(path[-1], target[:2]) < 1e-6 and math.dist(p[:2], target[:2]) < .5:
                    a, b = path[-2:]
                    projection = sum((p[i] - b[i]) * (b[i] - a[i]) for i in (0, 1)) / math.dist(a, b)
                    m['overshoot'] = max(m['overshoot'], projection)
        minimum = min(minimum, math.dist(*(p[:2] for p in poses.values())))
        if len(terminal) == 2 and all(abs(v) < 1e-5 and abs(w) < 1e-5 for v, w in velocities.values()):
            break
    for rid, m in metrics.items():
        m['state'], m['seconds'] = terminal.get(rid, ('timeout', now-100.))
        m['position'] = math.dist(targets[rid][:2], poses[rid][:2])
        m['yaw'] = abs(fleet.angle(targets[rid][2] - poses[rid][2]))
    return {'robots': metrics, 'minimum_separation': minimum}


class SimulatorRateTests(unittest.TestCase):
    def test_same_controller_accuracy_at_both_cruise_settings(self):
        starts, goals = SCENARIOS["head_on"]
        slow = simulate(starts, goals, phase=1, cruise=.45)["robots"]
        fast = simulate(starts, goals, phase=1, cruise=1.)["robots"]
        for robots, cruise in ((slow, .45), (fast, 1.)):
            self.assertAlmostEqual(max(m["peak_speed"] for m in robots.values()), cruise)
            for m in robots.values():
                self.assertEqual(m["state"], "succeeded", m)
                self.assertLessEqual(m["position"], .020, m)
        self.assertLess(sum(m["seconds"] for m in fast.values()),
                        sum(m["seconds"] for m in slow.values()))

    def test_faster_fleet_stops_accurately_and_keeps_clearance(self):
        for name, (starts, goals) in SCENARIOS.items():
            with self.subTest(name=name):
                result = simulate(starts, goals, phase=1)
                self.assertGreaterEqual(result['minimum_separation'], 3.)
                for m in result['robots'].values():
                    self.assertEqual(m['state'], 'succeeded', m)
                    self.assertLessEqual(m['position'], .025, m)
                    self.assertLessEqual(m['yaw'], .08, m)
                    self.assertLessEqual(m['cross_track'], .10, m)
                    self.assertLessEqual(m['overshoot'], .002, m)
                    self.assertEqual(m['intrusion'], 0, m)
                self.assertGreaterEqual(max(m['peak_speed'] for m in result['robots'].values()), .9)


def benchmark(cruise):
    results = {name: [simulate(*scenario, phase, cruise=cruise) for phase in range(5)]
               for name, scenario in SCENARIOS.items()}
    robots = [m for runs in results.values() for run in runs for m in run['robots'].values()]
    def stats(field):
        series = sorted(m[field] for m in robots)
        return dict(mean=statistics.mean(series), p95=series[math.ceil(.95 * len(series)) - 1], max=series[-1])
    return dict(summary={key: stats(key) for key in ('position', 'yaw', 'cross_track', 'seconds', 'overshoot')},
                goals=len(robots), succeeded=sum(m['state'] == 'succeeded' for m in robots),
                intrusions=sum(m['intrusion'] for m in robots), scenarios=results)


if __name__ == '__main__':
    print(json.dumps({cruise: benchmark(cruise) for cruise in (.45, 1.)}, indent=2))

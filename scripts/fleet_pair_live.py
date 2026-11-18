"""Stage two robots, then record one actual dashboard Start both run."""
import argparse
import json
import math
from pathlib import Path
import sys
import time
from uuid import uuid4

import rclpy
from nav_msgs.msg import Odometry, Path as RosPath
from std_msgs.msg import String
from agv_web_bridge.fleet import angle
from agv_web_bridge.simulation_node import SimulationNode, find_collision

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ros2_ws/src/agv_web_bridge/test'))
from test_fleet_speed_profile import segment_distance

IDS = ('agv1', 'agv2')
SCENARIOS = {
    'head_on': ((3.5, -5.0, math.pi / 2), (3.5, 8.0, -math.pi / 2)),
    'crossing': ((12.0, 2.28, math.pi), (5.0, -9.0, math.pi / 2)),
    'long_corner': ((20.0, 1.6, math.pi), (16.0, 10.5, math.pi)),
}


def goal(payload):
    return tuple(payload[k] for k in ('x', 'y', 'yaw'))


class Run:
    def __init__(self, node):
        self.node = node
        self.state = None
        self.start_time = None
        self.result = None
        self.active = {}
        self.latest_plan = {}
        self.latest_pose = {}
        self.latest_speed = {}
        self.commands = {}
        self.heartbeats = {}
        config = SimulationNode._load_config(SimulationNode._default_config_path())
        self.racks = [o for o in SimulationNode._build_obstacles(config) if o.id.startswith('RACK')]
        body = config['robot']
        self.robot_height = body['height']
        self.half_length = body['footprint_length'] / 2 + body.get('footprint_padding', 0.)
        self.half_width = body['footprint_width'] / 2 + body.get('footprint_padding', 0.)
        node.create_subscription(String, '/fleet/state', self.fleet, 10)
        node.create_subscription(String, '/fleet/start_pair', self.start_pair, 10)
        node.create_subscription(String, '/fleet/start_pair_result', self.rejection, 10)
        for rid in IDS:
            def subscribe(typ, suffix, handler):
                node.create_subscription(typ, f'/{rid}/{suffix}', lambda msg, rid=rid: handler(rid, msg), 10)
            subscribe(String, 'agv_web/navigation_command', self.command)
            subscribe(String, 'agv_web/collision_status', self.collision)
            subscribe(Odometry, 'agv_web/ground_truth', self.truth)
            subscribe(RosPath, 'plan', self.plan)
            self.commands[rid] = node.create_publisher(String, f'/{rid}/agv_web/navigation_command', 10)
            self.heartbeats[rid] = node.create_publisher(String, f'/{rid}/agv_web/operator_heartbeat', 10)

    def begin_leg(self, rid, request, target):
        m = dict(request_id=request, goal=target, started=time.monotonic() - self.start_time,
                 cross_track_m=0., overshoot_m=0., peak_speed_mps=0., rack_intrusion_samples=0)
        self.result['legs'][rid].append(m)
        self.active[rid] = m
        self.latest_plan.pop(rid, None)

    def start_pair(self, msg):
        data = json.loads(msg.data)
        if self.result is not None or 'goals' not in data:
            if self.result is not None and data.get('action') in ('stop', 'cancel'):
                self.result['pair_stop_messages'].append({
                    **data, 't': time.monotonic() - self.start_time,
                    'robots': self.state['robots'], 'speeds_mps': self.latest_speed.copy(),
                })
            return
        self.start_time = time.monotonic()
        self.result = dict(request_id=data['request_id'], start_poses=self.latest_pose.copy(),
                           legs={rid: [] for rid in IDS}, collisions=[], min_separation_m=None, timeline=[],
                           destinations=data.get('destinations', {}), pair_stop_messages=[],
                           per_robot_stop_messages=[])
        for rid in IDS:
            self.begin_leg(rid, data['request_id'], goal(data['goals'][rid]))

    def rejection(self, msg):
        data = json.loads(msg.data)
        if self.result and self.result['request_id'] == data.get('request_id'):
            self.result['rejection'] = data['issues']

    def command(self, rid, msg):
        data = json.loads(msg.data)
        if self.result and data.get('action') in ('stop', 'cancel'):
            self.result['per_robot_stop_messages'].append({'robot': rid, **data})

    @staticmethod
    def finish_leg(metrics, state, elapsed, terminal):
        metrics.update(terminal=terminal, seconds=elapsed-metrics['started'],
                       position_error_m=math.dist(state['pose'][:2], metrics['goal'][:2]),
                       yaw_error_rad=abs(angle(state['pose'][2]-metrics['goal'][2])))

    def fleet(self, msg):
        self.state = json.loads(msg.data)
        if self.result is None:
            return
        elapsed = time.monotonic() - self.start_time
        self.result['timeline'].append(dict(t=elapsed, separation=self.state['separation_m'], robots=self.state['robots']))
        for rid, state in self.state['robots'].items():
            m = self.active.get(rid)
            if not m or m['request_id'] != state.get('request_id') or 'terminal' in m:
                continue
            if state.get('pair_leg') == 1 and len(self.result['legs'][rid]) == 1:
                self.finish_leg(m, state, elapsed, 'succeeded')
                self.begin_leg(rid, m['request_id'], goal(self.result['destinations'][rid]))
                m = self.active[rid]
            if not state['busy']:
                self.finish_leg(m, state, elapsed, state['state'])

    def collision(self, rid, msg):
        data = json.loads(msg.data)
        if self.result and (data.get('collision') or data.get('blocked')):
            self.result['collisions'].append(dict(robot=rid, t=time.monotonic()-self.start_time, report=data))

    def plan(self, rid, msg):
        if msg.poses:
            self.latest_plan[rid] = [(p.pose.position.x, p.pose.position.y) for p in msg.poses]

    def truth(self, rid, msg):
        p, q = msg.pose.pose.position, msg.pose.pose.orientation
        pose = p.x, p.y, 2 * math.atan2(q.z, q.w)
        self.latest_pose[rid] = pose
        self.latest_speed[rid] = abs(msg.twist.twist.linear.x)
        if self.result is None:
            return
        if len(self.latest_pose) == 2:
            sep = math.dist(*(p[:2] for p in self.latest_pose.values()))
            self.result['min_separation_m'] = min(self.result['min_separation_m'] or math.inf, sep)
        m = self.active.get(rid)
        if not m:
            return
        m['peak_speed_mps'] = max(m['peak_speed_mps'], msg.twist.twist.linear.x)
        if find_collision(self.racks, *pose, self.half_length, self.half_width, self.robot_height):
            m['rack_intrusion_samples'] += 1
        path = self.latest_plan.get(rid, ())
        if len(path) > 1:
            m['cross_track_m'] = max(m['cross_track_m'], min(segment_distance(pose, a, b) for a, b in zip(path, path[1:])))
            a, b = path[-2:]
            if math.dist(b, m['goal'][:2]) < 1e-6 and math.dist(pose[:2], b) < .5:
                along = sum((pose[i] - b[i]) * (b[i] - a[i]) for i in (0, 1)) / math.dist(a, b)
                m['overshoot_m'] = max(m['overshoot_m'], along)

    def spin_until(self, condition, seconds, heartbeat=False):
        deadline = time.monotonic() + seconds
        next_heartbeat = 0.
        while time.monotonic() < deadline:
            if condition():
                return True
            if heartbeat and time.monotonic() >= next_heartbeat:
                for pub in self.heartbeats.values():
                    pub.publish(String(data='alive'))
                next_heartbeat = time.monotonic() + .2
            rclpy.spin_once(self.node, timeout_sec=.05)
        return False

    def stage(self, name):
        if not self.spin_until(lambda: self.state and all(r['ready'] for r in self.state['robots'].values()), 10, True):
            raise RuntimeError('Fleet telemetry unavailable for staging')
        request_id = f'stage-{name}-{uuid4()}'
        for rid, (x, y, yaw) in zip(IDS, SCENARIOS[name]):
            data = dict(action='goal', x=x, y=y, yaw=yaw, request_id=request_id)
            # Use the same rolling coordinator while staging.
            self.commands[rid].publish(String(data=json.dumps(data)))
        complete = self.spin_until(lambda: all(
            r.get('request_id') == request_id and not r['busy']
            for r in self.state['robots'].values()), 174, True)
        if not complete or not all(r['state'] == 'succeeded' for r in self.state['robots'].values()):
            raise RuntimeError('Staging failed: ' + json.dumps(self.state['robots']))

    def submit_conflict(self):
        publisher = self.node.create_publisher(String, '/fleet/start_pair', 10)
        self.spin_until(lambda: False, .6, True)
        def rack(y, yaw):
            return dict(action='goal', x=-12., y=y, yaw=yaw)
        publisher.publish(String(data=json.dumps(dict(
            request_id='live-same-column-rejection',
            goals={'agv1': rack(9.88, math.pi/2), 'agv2': rack(8.52, -math.pi/2)},
            destinations={'agv1': rack(16.12, -math.pi/2), 'agv2': rack(-12.92, math.pi/2)},
        ))))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('scenario', choices=SCENARIOS)
    parser.add_argument('--skip-stage', action='store_true')
    parser.add_argument('--expect', choices=('complete', 'stop', 'rejection'), default='complete')
    args = parser.parse_args()
    rclpy.init()
    node = rclpy.create_node('dashboard_pair_acceptance')
    run = Run(node)
    try:
        if not args.skip_stage:
            run.stage(args.scenario)
        if args.expect == 'rejection':
            run.submit_conflict()
        else:
            print('Ready for dashboard Start both', flush=True)
        if not run.spin_until(lambda: run.result is not None, 180):
            raise RuntimeError('No Start both message received')
        if args.expect == 'stop':
            if not run.spin_until(lambda: all(len(legs) == 2 for legs in run.result['legs'].values()), 150):
                raise RuntimeError('Both destination legs did not start')
            print('Both destination legs active. Ready for dashboard Stop all', flush=True)
        finished = run.spin_until(lambda: 'rejection' in run.result or all(
            'terminal' in run.active[rid] and (len(run.result['legs'][rid]) == 2 or run.active[rid]['terminal'] != 'succeeded')
            for rid in IDS), 240)
        run.spin_until(lambda: False, 1.)
        run.result['final_robots'] = run.state['robots']
        run.result['final_speeds_mps'] = run.latest_speed
        run.result['trip_seconds'] = max((m['started']+m.get('seconds', 0.) for m in run.active.values()), default=0.)
        assert finished, 'Live scenario did not terminate'
        if args.expect == 'rejection':
            assert set(run.result['rejection']) == set(IDS)
            assert all(not s['busy'] for s in run.state['robots'].values())
        elif args.expect == 'stop':
            stop = run.result['pair_stop_messages'][-1]
            assert stop['action'] == 'stop'
            assert all(s['pair_leg'] == 1 and s['busy'] for s in stop['robots'].values())
            assert not run.result['per_robot_stop_messages']
            assert all(m['terminal'] == 'canceled' for m in run.active.values())
            assert all(v <= .03 for v in run.latest_speed.values())
        else:
            assert all(len(legs) == 2 and all(m['terminal'] == 'succeeded' for m in legs)
                       for legs in run.result['legs'].values())
            assert all(max(m['peak_speed_mps'] for m in legs) >= .99 for legs in run.result['legs'].values())
            assert not run.result['collisions']
    finally:
        if run.result:
            suffix = args.scenario if args.expect == 'complete' else args.expect
            path = Path(f'/workspace/test_logs/fleet_review_live_{suffix}.json')
            path.write_text(json.dumps(run.result, indent=2))
            print(json.dumps({k:v for k,v in run.result.items() if k != 'timeline'}), flush=True)
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()

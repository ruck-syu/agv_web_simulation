import { useFleet } from '../fleet/FleetProvider';
import type { SourceGoal } from '../fleet/types';
import { createRobotContext, useRobotId } from '../fleet/RobotContext';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WAREHOUSE_LAYOUT } from '../config/warehouseConfig';
import collisionConfig from '../../../ros2_ws/src/agv_web_bridge/config/warehouse_collision.json';
import { useSimulation } from '../simulation/SimulationProvider';
import { useNavigation } from './NavigationProvider';
import { useRos } from '../ros/RosProvider';
import { distance, planFleetRoute, type RouteBox } from './routePlanner';
import type { PathPoint } from './types';

export const rackStops = WAREHOUSE_LAYOUT.rack.rows.map(row => ({
  id: row.id, label: row.label, x: row.x, y: -(row.z + row.face * 2.5), yaw: row.face * Math.PI / 2,
}));
// Circumscribed AGV radius + margin: allows rotation without clipping a rack.
const clearance = Math.hypot(1.55, 1.06) / 2 + 0.15;
const rackBoxes: RouteBox[] = WAREHOUSE_LAYOUT.rack.rows.map(row => ({
  minX: row.x - 12 - clearance, maxX: row.x + 12 + clearance,
  minY: -row.z - .8 - clearance, maxY: -row.z + .8 + clearance,
}));
const staticBoxes = collisionConfig.obstacles.filter(o => o.type !== 'wall').map(o => {
  const hx = Math.abs(Math.cos(o.yaw)) * o.hx + Math.abs(Math.sin(o.yaw)) * o.hy + clearance;
  const hy = Math.abs(Math.sin(o.yaw)) * o.hx + Math.abs(Math.cos(o.yaw)) * o.hy + clearance;
  return { minX: o.cx - hx, maxX: o.cx + hx, minY: o.cy - hy, maxY: o.cy + hy };
});
interface RackRouteState {
  source: string; destination: string; select: (source: string, destination: string) => void;
  preview: PathPoint[]; length: number; boxes: RouteBox[]; phase: string; error: string | null;
  start: () => string | null; stop: () => void; running: boolean; canStart: boolean; startIssue: () => string | null;
  sourceGoal: SourceGoal | null; destinationGoal: SourceGoal | null;
  beginPair: (id: string) => void; rejectPair: (id: string) => void;
}
type RackJob = {
  leg: number; expected: PathPoint; requestId: string; sentAt: number; acknowledged: boolean;
  paired: boolean; previousRequestId: string | null;
};
const Context = createRobotContext<RackRouteState>();
export function RackRouteProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState('B2'), [destination, setDestination] = useState('D1');
  const [phase, setPhase] = useState('Preview'), [error, setError] = useState<string | null>(null);
  const robotId = useRobotId();
  const { live: fleetLive, fleet } = useFleet();
  const { snapshot, collisionGeometry } = useSimulation();
  const { publish } = useRos();
  const { status, sendGoal, beginGoal, forgetGoal, cancel } = useNavigation();
  const job = useRef<RackJob | null>(null);
  const [running, setRunning] = useState(false);
  const boxes = useMemo(() => [...rackBoxes, ...(collisionGeometry ? collisionGeometry.obstacles.filter(o => !['wall', 'rack', 'rack_upright', 'rack_beam', 'rack_guard', 'rack_brace', 'rack_footplate'].includes(o.type) && !o.id.startsWith('RACK')).map(o => {
    const hx = Math.abs(Math.cos(o.yaw)) * o.hx + Math.abs(Math.sin(o.yaw)) * o.hy + clearance;
    const hy = Math.abs(Math.sin(o.yaw)) * o.hx + Math.abs(Math.cos(o.yaw)) * o.hy + clearance;
    return { minX: o.cx - hx, maxX: o.cx + hx, minY: o.cy - hy, maxY: o.cy + hy };
  }) : staticBoxes)], [collisionGeometry]);
  const from = rackStops.find(r => r.id === source), to = rackStops.find(r => r.id === destination);
  const preview = useMemo(() => !from || !to || source === destination ? [] : planFleetRoute(from, to), [source, destination, from, to, boxes]);
  const length = preview.reduce((sum, p, i) => sum + (i ? distance(preview[i - 1], p) : 0), 0);
  const startIssue = () => {
    const now = performance.now();
    if (!from || !to || !preview.length) return 'No valid source/destination route.';
    if (snapshot.connectionStatus !== 'connected') return 'Disconnected.';
    if (!fleetLive || !fleet || now - fleet.receivedAt >= 1500) return 'Fleet telemetry stale.';
    if (fleet.safety_stop) return 'Safety stop active.';
    if (running || job.current || status?.busy || fleet.robots[robotId].busy) return 'Already running.';
    if (snapshot.stale || !snapshot.telemetry || now - snapshot.telemetry.poseReceivedAt >= 1500 ||
        !snapshot.wheelOdometry || now - snapshot.wheelOdometry.poseReceivedAt >= 1500) return 'World telemetry or odometry stale.';
    if (!status || now - status.receivedAt >= 1500 || !status.ready || !fleet.robots[robotId].ready) return 'Coordinator not ready or stale.';
    return null;
  };
  const canStart = startIssue() === null;
  const beginLeg = (leg: number, target: PathPoint, requestId: string, paired = false) => {
    job.current = {
      leg, expected: { x: target.x, y: target.y }, requestId, sentAt: performance.now(),
      acknowledged: false, paired, previousRequestId: status?.requestId ?? null,
    };
    setRunning(true);
    setPhase(leg === 0 ? 'Travelling to source rack' : 'Travelling to destination rack');
  };
  const dispatch = (leg: number): string | null => {
    if (snapshot.stale || !snapshot.wheelOdometry || performance.now() - snapshot.wheelOdometry.poseReceivedAt > 1500) return 'Fresh world telemetry and odometry required.';
    const target = leg === 0 ? from : to;
    if (!target) return 'No valid rack goal.';
    const result = sendGoal(target.x, target.y, target.yaw);
    if (typeof result === 'string') return result;
    beginLeg(leg, target, result.id);
    return null;
  };
  const rackGoal = (rack: typeof from): SourceGoal | null =>
    rack ? { action: 'goal', x: rack.x, y: rack.y, yaw: rack.yaw } : null;
  const sourceGoal = rackGoal(from), destinationGoal = rackGoal(to);
  const beginPair = (requestId: string) => {
    if (!sourceGoal) return;
    setError(null);
    beginGoal();
    beginLeg(0, sourceGoal, requestId, true);
  };
  const rejectPair = (requestId: string) => {
    if (job.current?.requestId !== requestId) return;
    job.current = null;
    forgetGoal();
    setRunning(false);
    setPhase('Start rejected');
  };
  const cancelJob = (active: RackJob) => {
    if (!active.paired) { cancel(); return; }
    forgetGoal();
    try {
      publish('/fleet/start_pair', 'std_msgs/msg/String', {
        data: JSON.stringify({ action: 'cancel', request_id: active.requestId }),
      });
    } catch { /* coordinator heartbeat stops motion after disconnect */ }
  };
  const endJob = (nextPhase: string) => {
    job.current = null;
    setRunning(false);
    setPhase(nextPhase);
  };
  useEffect(() => {
    const active = job.current;
    if (!active) return;
    if (snapshot.connectionStatus !== 'connected' || snapshot.stale || !status || performance.now() - status.receivedAt > 1500) {
      endJob('Interrupted'); cancelJob(active); return;
    }
    if (performance.now() - active.sentAt > 10000 && !active.acknowledged) {
      endJob('Interrupted'); setError('Fleet coordinator did not acknowledge the goal.'); cancelJob(active); return;
    }
    if (status.receivedAt <= active.sentAt) return;
    // Receipt time alone cannot correlate queued terminal messages to a new goal.
    // Updated coordinators echo the request id even after clearing the goal.
    const matchingRequest = status.requestId === active.requestId;
    if (status.requestId !== null && !matchingRequest) {
      if (!active.acknowledged && status.requestId === active.previousRequestId) return;
      endJob('Interrupted');
      if (active.paired) cancelJob(active);
      return;
    }
    if (matchingRequest || (!active.paired && status.busy && status.goal &&
        distance(active.expected, { x: status.goal[0], y: status.goal[1] }) < .05)) active.acknowledged = true;
    if (!active.acknowledged || (active.paired && !matchingRequest)) return;
    if (active.paired && status.pairLeg === 1 && active.leg === 0) {
      active.leg = 1;
      setPhase('Travelling to destination rack');
    }
    if (status.state === 'succeeded') {
      job.current = null;
      if (!active.paired && active.leg === 0) { const issue = dispatch(1); if (issue) { setError(issue); endJob('Interrupted'); } }
      else { setRunning(false); setPhase('Route complete'); }
    } else if (['failed', 'canceled', 'stopped', 'rejected', 'unavailable', 'safety_stop'].includes(status.state) || (!status.busy && status.mode === 'manual')) {
      job.current = null; setRunning(false); setPhase('Interrupted');
    }
  });
  const stop = () => {
    const active = job.current;
    endJob('Stopped');
    if (active) cancelJob(active);
    else cancel();
  };
  useEffect(() => {
    const stopAll = () => { job.current = null; setRunning(false); setPhase('Stopped'); };
    window.addEventListener('fleet-stop-all', stopAll);
    return () => window.removeEventListener('fleet-stop-all', stopAll);
  }, []);
  const start = () => {
    setError(null);
    const issue = startIssue() ?? dispatch(0);
    setError(issue);
    return issue;
  };
  const select = (a: string, b: string) => { if (running) return; setSource(a); setDestination(b); setError(null); setPhase('Preview'); };
  return <Context.Provider value={{ source, destination, select, preview, boxes, length, phase, error, start, stop, running, canStart, startIssue, sourceGoal, destinationGoal, beginPair, rejectPair }}>{children}</Context.Provider>;
}
export function useRackRoute() { return Context.useValue(); }

export function useRackRoutes() { return Context.useValues(); }

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WAREHOUSE_LAYOUT } from '../config/warehouseConfig';
import collisionConfig from '../../../ros2_ws/src/agv_web_bridge/config/warehouse_collision.json';
import { useSimulation } from '../simulation/SimulationProvider';
import { useMapping } from '../mapping/MappingProvider';
import { transformPose } from '../mapping/types';
import { useNavigation } from './NavigationProvider';
import { distance, planRoute, type RouteBox } from './routePlanner';
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
  start: () => void; stop: () => void; running: boolean; canStart: boolean;
}
const Context = createContext<RackRouteState | null>(null);
export function RackRouteProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState('B2'), [destination, setDestination] = useState('D1');
  const [phase, setPhase] = useState('Preview'), [error, setError] = useState<string | null>(null);
  const { snapshot, collisionGeometry } = useSimulation();
  const { transform } = useMapping();
  const { status, sendGoal, cancel } = useNavigation();
  const job = useRef<{ leg: number; expected: PathPoint; sentAt: number; acknowledged: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const boxes = useMemo(() => [...rackBoxes, ...(collisionGeometry ? collisionGeometry.obstacles.filter(o => !['wall', 'rack', 'rack_upright', 'rack_beam', 'rack_guard', 'rack_brace', 'rack_footplate'].includes(o.type) && !o.id.startsWith('RACK')).map(o => {
    const hx = Math.abs(Math.cos(o.yaw)) * o.hx + Math.abs(Math.sin(o.yaw)) * o.hy + clearance;
    const hy = Math.abs(Math.sin(o.yaw)) * o.hx + Math.abs(Math.cos(o.yaw)) * o.hy + clearance;
    return { minX: o.cx - hx, maxX: o.cx + hx, minY: o.cy - hy, maxY: o.cy + hy };
  }) : staticBoxes)], [collisionGeometry]);
  const from = rackStops.find(r => r.id === source)!, to = rackStops.find(r => r.id === destination)!;
  const preview = useMemo(() => source === destination ? [] : planRoute(from, to, boxes), [source, destination, from, to, boxes]);
  const length = preview.reduce((sum, p, i) => sum + (i ? distance(preview[i - 1], p) : 0), 0);
  const now = performance.now();
  const canStart = !running && preview.length > 0 && snapshot.connectionStatus === 'connected' && !snapshot.stale &&
    !!snapshot.telemetry && !!snapshot.wheelOdometry && now - snapshot.wheelOdometry.poseReceivedAt < 1500 &&
    !!transform && now - transform.receivedAt < 1500 && !!status && now - status.receivedAt < 1500 &&
    !status.busy && status.serverReady && status.sensorsReady && status.localizationReady && status.operatorReady;
  const dispatch = (leg: number): string | null => {
    const truth = snapshot.telemetry, odom = snapshot.wheelOdometry;
    if (!transform || !truth || !odom || snapshot.stale || performance.now() - transform.receivedAt > 1500 || performance.now() - odom.poseReceivedAt > 1500) return 'Fresh localization and robot telemetry are required.';
    const localized = transformPose(transform, odom.pose);
    const rotation = localized.yaw - truth.pose.yaw;
    const target = leg === 0 ? from : to;
    const dx = target.x - truth.pose.x, dy = target.y - truth.pose.y;
    const expected = { x: localized.x + Math.cos(rotation) * dx - Math.sin(rotation) * dy,
      y: localized.y + Math.sin(rotation) * dx + Math.cos(rotation) * dy };
    const issue = sendGoal(expected.x, expected.y, target.yaw + rotation);
    if (!issue) { job.current = { leg, expected, sentAt: performance.now(), acknowledged: false }; setRunning(true); setPhase(leg === 0 ? 'Travelling to source rack' : 'Travelling to destination rack'); }
    return issue;
  };
  useEffect(() => {
    const active = job.current;
    if (!active) return;
    if (snapshot.connectionStatus !== 'connected' || snapshot.stale || !status || performance.now() - status.receivedAt > 1500) {
      job.current = null; setRunning(false); setPhase('Interrupted'); return;
    }
    if (performance.now() - active.sentAt > 10000 && !active.acknowledged) {
      job.current = null; setRunning(false); setPhase('Interrupted'); setError('Nav2 did not acknowledge the goal.'); cancel(); return;
    }
    if (status.receivedAt <= active.sentAt || !status.goal || distance(active.expected, { x: status.goal[0], y: status.goal[1] }) > .05) return;
    if (status.busy) active.acknowledged = true;
    if (!active.acknowledged) return;
    if (status.state === 'succeeded') {
      job.current = null;
      if (active.leg === 0) { const issue = dispatch(1); if (issue) { setError(issue); setRunning(false); setPhase('Interrupted'); } }
      else { setRunning(false); setPhase('Route complete'); }
    } else if (['failed', 'canceled', 'stopped', 'rejected', 'unavailable'].includes(status.state) || (!status.busy && status.mode === 'manual')) {
      job.current = null; setRunning(false); setPhase('Interrupted');
    }
  });
  const stop = () => { job.current = null; setRunning(false); setPhase('Stopped'); cancel(); };
  const start = () => {
    setError(null);
    if (!preview.length) { setError('No route available between these racks.'); return; }
    if (!status || status.busy || !status.serverReady || !status.sensorsReady || !status.localizationReady || !status.operatorReady || performance.now() - status.receivedAt > 1500) { setError('Wait for Nav2 and fresh sensors/localization.'); return; }
    setError(dispatch(0));
  };
  const select = (a: string, b: string) => { if (running) return; setSource(a); setDestination(b); setError(null); setPhase('Preview'); };
  return <Context.Provider value={{ source, destination, select, preview, boxes, length, phase, error, start, stop, running, canStart }}>{children}</Context.Provider>;
}
export function useRackRoute() { const value = useContext(Context); if (!value) throw new Error('RackRouteProvider required'); return value; }

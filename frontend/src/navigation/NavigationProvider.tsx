import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRobotContext, useRobotId } from '../fleet/RobotContext';
import { useFleet } from '../fleet/FleetProvider';
import { useSimulation } from '../simulation/SimulationProvider';
import { useRos } from '../ros/RosProvider';
import { useRosTopic } from '../hooks/useRosTopic';
import fleetGrid from './fleetGrid.json' with { type: 'json' };
import { parseNavigation, parsePath, type NavigationStatus, type PathPoint } from './types';

const [minX, maxX, minY, maxY] = fleetGrid.bounds;
interface NavigationContext {
  status: NavigationStatus | null; path: PathPoint[];
  sendGoal: (x: number, y: number, yaw: number) => string | { id: string }; beginGoal: () => void; forgetGoal: () => void; cancel: () => void;
}
const Context = createRobotContext<NavigationContext>();
export function NavigationProvider({ children }: { children: ReactNode }) {
  const robotId = useRobotId();
  const { state, publish, appendLog } = useRos();
  const { snapshot } = useSimulation();
  const { fleet, live: fleetLive } = useFleet();
  const [status, setStatus] = useState<NavigationStatus | null>(null), [path, setPath] = useState<PathPoint[]>([]);
  const unsafeCanceled = useRef(false);
  const lastState = useRef<string | null>(null), requested = useRef(false);
  useRosTopic(`/${robotId}/agv_web/navigation_status`, 'std_msgs/msg/String', message => {
    const value = parseNavigation(message.data);
    if (!value) return;
    setStatus(value);
    if (!value.busy) { setPath([]); requested.current = false; }
    if (value.state !== lastState.current) {
      lastState.current = value.state;
      appendLog(value.state === 'failed' ? 'error' : 'info', robotId, value.detail);
    }
  });
  useRosTopic(`/${robotId}/plan`, 'nav_msgs/msg/Path', message => { const value = parsePath(message); if (value) setPath(value); });
  const command = useCallback((payload: Record<string, unknown>) => publish(`/${robotId}/agv_web/navigation_command`, 'std_msgs/msg/String', { data: JSON.stringify(payload) }), [publish, robotId]);
  const cancel = useCallback(() => { requested.current = false; setPath([]); try { command({ action: 'cancel' }); } catch { /* backend watchdog stops disconnected motion */ } }, [command]);
  useEffect(() => {
    if (state.status !== 'connected') { setStatus(null); setPath([]); return; }
    const heartbeat = () => {
      if (document.visibilityState === 'hidden') return;
      try { publish(`/${robotId}/agv_web/operator_heartbeat`, 'std_msgs/msg/String', { data: 'alive' }); } catch { /* reconnect owns recovery */ }
    };
    heartbeat(); const timer = window.setInterval(heartbeat, 250);
    return () => window.clearInterval(timer);
  }, [state.status, publish, robotId]);
  const unsafe = snapshot.stale || state.status !== 'connected' || !fleetLive || fleet?.safety_stop || !status || performance.now() - status.receivedAt > 1500;
  useEffect(() => {
    if (!unsafe) unsafeCanceled.current = false;
    else if (!unsafeCanceled.current && (requested.current || status?.busy)) {
      unsafeCanceled.current = true;
      cancel();
    }
  }, [unsafe, status, cancel]);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') cancel(); };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [cancel]);
  const beginGoal = () => {
    unsafeCanceled.current = false;
    requested.current = true;
    setPath([]);
  };
  const forgetGoal = () => { requested.current = false; };
  const sendGoal = (x: number, y: number, yaw: number) => {
    if (![x, y, yaw].every(Number.isFinite)) return 'Enter finite x, y and yaw values.';
    if (x < minX || x > maxX || y < minY || y > maxY) {
      return `Goal is outside world bounds (x ${minX} to ${maxX} m, y ${minY} to ${maxY} m).`;
    }
    if (unsafe || !status?.ready) return 'Fresh fleet status, truth, odometry, floor scan and heartbeat required.';
    try { const id = crypto.randomUUID(); command({ action: 'goal', x, y, yaw, request_id: id }); beginGoal(); return { id }; }
    catch (error) { return error instanceof Error ? error.message : 'Unable to send goal'; }
  };
  return <Context.Provider value={{ status, path, sendGoal, beginGoal, forgetGoal, cancel }}>{children}</Context.Provider>;
}
export function useNavigation() { return Context.useValue(); }

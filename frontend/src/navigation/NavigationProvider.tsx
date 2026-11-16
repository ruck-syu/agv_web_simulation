import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRos } from '../ros/RosProvider';
import { useRosTopic } from '../hooks/useRosTopic';
import { parseNavigation, parsePath, type NavigationStatus, type PathPoint } from './types';
interface NavigationContext {
  status: NavigationStatus | null;
  path: PathPoint[];
  sendGoal: (x: number, y: number, yaw: number) => string | null;
  cancel: () => void;
}
const Context = createContext<NavigationContext | null>(null);
export function NavigationProvider({ children }: { children: ReactNode }) {
  const { state, publish, appendLog } = useRos();
  const [status, setStatus] = useState<NavigationStatus | null>(null);
  const lastState = useRef<string | null>(null);
  const [path, setPath] = useState<PathPoint[]>([]);
  useRosTopic('/agv_web/navigation_status', 'std_msgs/msg/String', (message) => {
    const value = parseNavigation(message.data);
    if (value) {
      setStatus(value);
      if (value.state !== 'navigating') setPath([]);
      if (value.state !== lastState.current) {
        lastState.current = value.state;
        appendLog(value.state === 'failed' ? 'error' : value.state === 'succeeded' ? 'success' : 'info', 'NAV', value.detail);
      }
    }
  });
  useRosTopic('/plan', 'nav_msgs/msg/Path', (message) => { const value = parsePath(message); if (value) setPath(value); });
  const command = (payload: Record<string, unknown>) => publish('/agv_web/navigation_command', 'std_msgs/msg/String', { data: JSON.stringify(payload) });
  useEffect(() => {
    if (state.status !== 'connected') { setStatus(null); setPath([]); return; }
    const heartbeat = () => {
      if (document.visibilityState === 'hidden') return;
      try { publish('/agv_web/operator_heartbeat', 'std_msgs/msg/String', { data: 'alive' }); } catch { /* reconnect owns recovery */ }
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 250);
    return () => window.clearInterval(timer);
  }, [state.status, publish]);
  const sendGoal = (x: number, y: number, yaw: number) => {
    if (![x, y, yaw].every(Number.isFinite) || Math.abs(x) > 100 || Math.abs(y) > 100) return 'Enter a finite map goal within ±100 m.';
    try { command({ action: 'goal', x, y, yaw }); setPath([]); appendLog('info', 'NAV', `Requested map goal ${x.toFixed(2)}, ${y.toFixed(2)} m.`); return null; }
    catch (error) { return error instanceof Error ? error.message : 'Unable to send goal'; }
  };
  const cancel = () => { try { command({ action: 'cancel' }); setPath([]); } catch { /* backend heartbeat stops disconnected motion */ } };
  return <Context.Provider value={{ status, path, sendGoal, cancel }}>{children}</Context.Provider>;
}
export function useNavigation() { const value = useContext(Context); if (!value) throw new Error('NavigationProvider required'); return value; }

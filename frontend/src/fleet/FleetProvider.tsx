import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRos } from '../ros/RosProvider';
import { useRosTopic } from '../hooks/useRosTopic';
import { parseFleet, type FleetState } from './types';
import type { RobotId } from './RobotContext';
const Context = createContext<{selected: RobotId; select: (id: RobotId) => void; fleet: FleetState | null; live: boolean; stopAll: () => void; stopEpoch: number; connected: boolean; stopErrors: string[]} | null>(null);
export function FleetProvider({ children }: { children: ReactNode }) {
  const [selected, select] = useState<RobotId>('agv1'), [fleet, setFleet] = useState<FleetState | null>(null);
  const [now, setNow] = useState(performance.now()), [stopEpoch, setStopEpoch] = useState(0);
  const [stopErrors, setStopErrors] = useState<string[]>([]);
  const { state, publish, appendLog } = useRos();
  useRosTopic('/fleet/state', 'std_msgs/msg/String', message => { const value = parseFleet(message.data); if (value) setFleet(value); });
  useEffect(() => { const timer = window.setInterval(() => setNow(performance.now()), 100); return () => clearInterval(timer); }, []);
  useEffect(() => { if (state.status !== 'connected') setFleet(null); }, [state.status]);
  const live = state.status === 'connected' && !!fleet && now - fleet.receivedAt < 1500;
  const stopAll = () => {
    if (state.status !== 'connected') return;
    window.dispatchEvent(new Event('fleet-stop-all'));
    setStopEpoch(n => n + 1);
    // Use the same publisher as admission so this stop follows any queued Start both.
    try {
      publish('/fleet/start_pair', 'std_msgs/msg/String', { data: JSON.stringify({ action: 'stop' }) });
      setStopErrors([]);
    } catch (error) {
      const message = `Fleet stop failed: ${error instanceof Error ? error.message : String(error)}`;
      setStopErrors([message]);
      appendLog('error', 'Fleet', message);
    }
  };
  return <Context.Provider value={{ selected, select, fleet, live, stopAll, stopEpoch, connected: state.status === 'connected', stopErrors }}>{children}</Context.Provider>;
}
export function useFleet() { const value = useContext(Context); if (!value) throw new Error('FleetProvider required'); return value; }

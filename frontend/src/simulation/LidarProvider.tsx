import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { APP_CONFIG } from '../config/appConfig';
import { useRosTopic } from '../hooks/useRosTopic';
import { useRos } from '../ros/RosProvider';
import { useSimulation } from './SimulationProvider';
import { parseScan, type LidarScan } from './lidar';
import type { RobotPose } from './types';

interface LidarState {
  scan: LidarScan | null;
  pose: RobotPose | null;
  live: boolean;
  visible: boolean;
  raysVisible: boolean;
  setRaysVisible: (visible: boolean) => void;
  setVisible: (visible: boolean) => void;
}
const Context = createContext<LidarState | null>(null);
export function LidarProvider({ children }: { children: ReactNode }) {
  const { state } = useRos();
  const { getLatestTelemetry } = useSimulation();
  const [reading, setReading] = useState<{ scan: LidarScan; pose: RobotPose | null } | null>(null);
  const [raysVisible, setRaysVisible] = useState(true);
  const [visible, setVisible] = useState(true);
  const [now, setNow] = useState(performance.now());
  useRosTopic(APP_CONFIG.ros.topics.scan.name, APP_CONFIG.ros.topics.scan.messageType, (message) => {
    if (state.status !== 'connected') return;
    const scan = parseScan(message);
    if (!scan) return;
    const telemetry = getLatestTelemetry();
    const pose = telemetry && performance.now() - telemetry.poseReceivedAt < 300
      ? { ...telemetry.pose } : null;
    setReading({ scan, pose });
  });
  useEffect(() => {
    if (state.status !== 'connected') setReading(null);
  }, [state.status]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const live = state.status === 'connected' && reading !== null &&
    now - reading.scan.receivedAt < 1500;
  return <Context.Provider value={{ scan: reading?.scan ?? null, pose: reading?.pose ?? null,
    live, visible, setVisible, raysVisible, setRaysVisible }}>{children}</Context.Provider>;
}
export function useLidar() {
  const value = useContext(Context);
  if (!value) throw new Error('useLidar requires LidarProvider');
  return value;
}

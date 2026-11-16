import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRos } from '../ros/RosProvider';
import { useRosTopic } from '../hooks/useRosTopic';
import { parseMap, parseMapTransform, type OccupancyMap, type PlanarTransform } from './types';
interface MappingState { map: OccupancyMap | null; transform: PlanarTransform | null }
const Context = createContext<MappingState>({ map: null, transform: null });
export function MappingProvider({ children }: { children: ReactNode }) {
  const { state } = useRos();
  const [map, setMap] = useState<OccupancyMap | null>(null);
  const [transform, setTransform] = useState<PlanarTransform | null>(null);
  useRosTopic('/map', 'nav_msgs/msg/OccupancyGrid', (message) => { const value = parseMap(message); if (value) setMap(value); });
  useRosTopic('/tf', 'tf2_msgs/msg/TFMessage', (message) => { const value = parseMapTransform(message); if (value) setTransform(value); });
  useEffect(() => { if (state.status !== 'connected') { setMap(null); setTransform(null); } }, [state.status]);
  return <Context.Provider value={{ map, transform }}>{children}</Context.Provider>;
}
export function useMapping() { return useContext(Context); }

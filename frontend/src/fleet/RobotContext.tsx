import { createContext, useContext, type ReactNode } from 'react';
import { useFleet } from './FleetProvider';
export type RobotId = 'agv1' | 'agv2';
export const ROBOTS: RobotId[] = ['agv1', 'agv2'];
export const ROBOT_COLORS = { agv1: '#21c9f3', agv2: '#ffb454' };
const Scope = createContext<RobotId | null>(null);
export function RobotScope({ id, children }: { id: RobotId | null; children: ReactNode }) {
  return <Scope.Provider value={id}>{children}</Scope.Provider>;
}
export function useRobotId() { const scope = useContext(Scope); const { selected } = useFleet(); return scope ?? selected; }
// Both runtimes stay mounted. Nested maps expose either robot to scene and UI consumers.
export function createRobotContext<T>() {
  const Context = createContext<Partial<Record<RobotId, T>>>({});
  function Provider({ value, children }: { value: T; children: ReactNode }) {
    const inherited = useContext(Context), id = useRobotId();
    return <Context.Provider value={{ ...inherited, [id]: value }}>{children}</Context.Provider>;
  }
  function useValue(): T { const values = useContext(Context), id = useRobotId(); const value = values[id]; if (!value) throw new Error(`Missing runtime for ${id}`); return value; }
  return { Provider, useValue, useValues: () => useContext(Context) };
}

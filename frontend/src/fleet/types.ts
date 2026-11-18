export const ROBOT_IDS = ['agv1', 'agv2'] as const;
export interface FleetRobot {
  state: string; detail: string; mode: string; ready: boolean; busy: boolean;
  pose: [number, number, number] | null; goal: [number, number, number] | null; waiting_on: string[];
}
export interface FleetState {
  schema_version: number; frame_id: string; safety_stop: boolean; separation_m: number | null;
  robots: Record<'agv1' | 'agv2', FleetRobot>;
  reserved_zones: Record<'agv1' | 'agv2', [number, number][]>; receivedAt: number;
}
export function parseFleet(data: unknown): FleetState | null {
  try {
    const item = typeof data === 'string' ? JSON.parse(data) : null;
    if (!item || item.schema_version !== 1 || item.frame_id !== 'world' || typeof item.safety_stop !== 'boolean') return null;
    if (item.separation_m !== null && (typeof item.separation_m !== 'number' || !Number.isFinite(item.separation_m) || item.separation_m < 0)) return null;
    for (const id of ROBOT_IDS) {
      const r = item.robots?.[id], zones = item.reserved_zones?.[id];
      if (!r || typeof r.state !== 'string' || typeof r.detail !== 'string' || !['manual', 'autonomous'].includes(r.mode) || typeof r.ready !== 'boolean' || typeof r.busy !== 'boolean' || !Array.isArray(r.waiting_on) || !r.waiting_on.every((x: unknown) => typeof x === 'string')) return null;
      for (const p of [r.pose, r.goal]) if (p !== null && (!Array.isArray(p) || p.length !== 3 || !p.every((x: unknown) => typeof x === 'number' && Number.isFinite(x)))) return null;
      if (!Array.isArray(zones) || zones.length > 50000 || !zones.every((z: unknown) => Array.isArray(z) && z.length === 2 && z.every(Number.isSafeInteger))) return null;
    }
    return { ...item, receivedAt: performance.now() };
  } catch { return null; }
}

type RobotId = typeof ROBOT_IDS[number];

export type SourceGoal = { action: 'goal'; x: number; y: number; yaw: number };
type Route = {
  startIssue: () => string | null;
  sourceGoal: SourceGoal | null;
  destinationGoal: SourceGoal | null;
  beginPair: (id: string) => void;
};
type Routes = Partial<Record<RobotId, Route>>;
type PairCommand = {
  request_id: string;
  goals: Record<RobotId, SourceGoal>;
  destinations: Record<RobotId, SourceGoal>;
};

// Match the coordinator's parked-peer clearance plus the arrival tolerance.
const PAIR_CLEARANCE = 3.32;

export function pairIssues(routes: Routes, separation?: number | null): string[] {
  if (separation != null && separation < PAIR_CLEARANCE) {
    return [`Robots must be at least ${PAIR_CLEARANCE} m apart before starting.`];
  }
  const issues = ROBOT_IDS.flatMap(id => {
    const route = routes[id];
    const issue = route?.startIssue() ?? (route?.sourceGoal && route.destinationGoal ? null : 'Rack route unavailable.');
    return issue ? [`${id}: ${issue}`] : [];
  });
  if (issues.length) return issues;
  const first = routes.agv1!, second = routes.agv2!;
  const stops = (route: Route) => [
    { label: 'source', goal: route.sourceGoal! },
    { label: 'destination', goal: route.destinationGoal! },
  ];
  for (const a of stops(first)) {
    for (const b of stops(second)) {
      if (Math.hypot(a.goal.x - b.goal.x, a.goal.y - b.goal.y) < PAIR_CLEARANCE) {
        return [`agv1: Selected ${a.label} rack is too close to agv2's ${b.label} rack.`,
          `agv2: Selected ${b.label} rack is too close to agv1's ${a.label} rack.`];
      }
    }
  }
  return [];
}

export function startBoth(routes: Routes, publish: (command: PairCommand) => void, requestId = crypto.randomUUID(), separation?: number | null): string[] {
  const issues = pairIssues(routes, separation);
  if (issues.length) return issues;
  const first = routes.agv1!, second = routes.agv2!;
  try {
    publish({
      request_id: requestId,
      goals: { agv1: first.sourceGoal!, agv2: second.sourceGoal! },
      destinations: { agv1: first.destinationGoal!, agv2: second.destinationGoal! },
    });
  } catch (error) {
    return [`Both routes could not be sent. ${error instanceof Error ? error.message : String(error)}`];
  }
  first.beginPair(requestId);
  second.beginPair(requestId);
  return [];
}

export function pairRejection(data: unknown) {
  try {
    const value = typeof data === 'string' ? JSON.parse(data) : null;
    if (typeof value?.request_id !== 'string') return null;
    const issues = ROBOT_IDS.flatMap(id => typeof value.issues?.[id] === 'string' ? [`${id}: ${value.issues[id]}`] : []);
    return issues.length ? { requestId: value.request_id as string, issues } : null;
  } catch {
    return null;
  }
}

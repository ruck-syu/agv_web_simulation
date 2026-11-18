export interface NavigationStatus {
  requestId: string | null;
  pairLeg: 0 | 1 | null;
  state: string;
  detail: string;
  mode: string;
  busy: boolean;
  ready: boolean;
  distanceRemaining: number | null;
  goal: [number, number, number] | null;
  receivedAt: number;
}
export interface PathPoint { x: number; y: number }
export function parseNavigation(data: unknown): NavigationStatus | null {
  if (typeof data !== 'string') return null;
  let item;
  try { item = JSON.parse(data); } catch { return null; }
  if (!item || typeof item !== 'object' || typeof item.state !== 'string' || typeof item.detail !== 'string' ||
      !['manual', 'autonomous'].includes(item.mode)) return null;
  const goal = Array.isArray(item.goal) && item.goal.length === 3 && item.goal.every((v: unknown) => typeof v === 'number' && Number.isFinite(v)) ? item.goal : null;
  return { requestId: typeof item.request_id === 'string' ? item.request_id : null,
    pairLeg: item.pair_leg === 0 || item.pair_leg === 1 ? item.pair_leg : null,
    state: item.state, detail: item.detail, mode: item.mode, busy: item.busy === true, ready: item.ready === true,
    distanceRemaining: typeof item.distance_remaining === 'number' && Number.isFinite(item.distance_remaining) && item.distance_remaining >= 0 ? item.distance_remaining : null,
    goal, receivedAt: performance.now() };
}
export function parsePath(message: Record<string, unknown>): PathPoint[] | null {
  if ((message.header as { frame_id?: string } | undefined)?.frame_id !== 'world' ||
      !Array.isArray(message.poses) || message.poses.length > 20000) return null;
  const result: PathPoint[] = [];
  const stride = Math.max(1, Math.ceil(message.poses.length / 2000));
  for (let index = 0; index < message.poses.length; index = Math.min(index + stride, message.poses.length - 1)) {
    const item = message.poses[index] as { pose?: { position?: { x?: unknown; y?: unknown } } } | null;
    const position = item?.pose?.position;
    if (!position || typeof position.x !== 'number' || !Number.isFinite(position.x) ||
        typeof position.y !== 'number' || !Number.isFinite(position.y)) return null;
    result.push({ x: position.x, y: position.y });
    if (index === message.poses.length - 1) break;
  }
  return result;
}

import type { PathPoint } from './types';

export interface RouteBox { minX: number; maxX: number; minY: number; maxY: number }
export const distance = (a: PathPoint, b: PathPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (p: PathPoint, b: RouteBox) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** Segment/slab intersection, including tangencies, so previews never cut corners. */
export function segmentBlocked(a: PathPoint, b: PathPoint, boxes: RouteBox[]) {
  return boxes.some((box) => {
    let low = 0, high = 1;
    for (const axis of ['x', 'y'] as const) {
      const min = axis === 'x' ? box.minX : box.minY, max = axis === 'x' ? box.maxX : box.maxY;
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-9) { if (a[axis] < min || a[axis] > max) return false; }
      else {
        const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta;
        low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
        if (low > high) return false;
      }
    }
    return true;
  });
}

/** Shortest visibility-graph route around conservative, clearance-expanded boxes. */
export function planRoute(start: PathPoint, end: PathPoint, boxes: RouteBox[]): PathPoint[] {
  const valid = (p: PathPoint) => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 30.5 && Math.abs(p.y) < 18.5 && !boxes.some(b => inside(p, b));
  if (!valid(start) || !valid(end)) return [];
  const nodes = [start, end, ...boxes.flatMap(b => [
    { x: b.minX - 0.02, y: b.minY - 0.02 }, { x: b.minX - 0.02, y: b.maxY + 0.02 },
    { x: b.maxX + 0.02, y: b.minY - 0.02 }, { x: b.maxX + 0.02, y: b.maxY + 0.02 },
  ]).filter(valid)];
  const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set<number>();
  costs[0] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (current < 0 || costs[i] < costs[current])) current = i;
    if (current < 0 || !Number.isFinite(costs[current])) return [];
    if (current === 1) {
      const path = [nodes[1]];
      while (previous[current] >= 0) { current = previous[current]; path.unshift(nodes[current]); }
      return path;
    }
    visited.add(current);
    for (let i = 0; i < nodes.length; i++) {
      if (visited.has(i)) continue;
      const cost = costs[current] + distance(nodes[current], nodes[i]);
      if (cost < costs[i] && !segmentBlocked(nodes[current], nodes[i], boxes)) { costs[i] = cost; previous[i] = current; }
    }
  }
  return [];
}

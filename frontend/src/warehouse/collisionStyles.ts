export interface CollisionStyle {
  color: string;
  height: number;
}

export const COLLISION_TYPE_STYLE: Record<string, CollisionStyle> = {
  wall: { color: '#8f9ba8', height: 10.2 },
  rack: { color: '#ff9f43', height: 6.6 },
  rack_support: { color: '#5b8def', height: 6.6 },
  rack_base: { color: '#b8c2cc', height: 0.03 },
  rack_shelf: { color: '#ff9f43', height: 6.6 },
  rack_brace: { color: '#a06cd5', height: 5.2 },
  rack_guard: { color: '#ffd166', height: 1.16 },
  pallet: { color: '#4cc9f0', height: 1.05 },
  pallet_stack: { color: '#48b5d8', height: 1.35 },
  cone: { color: '#f72585', height: 0.48 },
  drum: { color: '#c77dff', height: 0.86 },
  charging_station: { color: '#80ed99', height: 1.72 },
  bollard: { color: '#f4d35e', height: 1.12 },
};

export const DEFAULT_COLLISION_STYLE: CollisionStyle = {
  color: '#9aa5b1',
  height: 1,
};

export function collisionStyleFor(type: string): CollisionStyle {
  return COLLISION_TYPE_STYLE[type] ?? DEFAULT_COLLISION_STYLE;
}

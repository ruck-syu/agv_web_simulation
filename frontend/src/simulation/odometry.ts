export interface OdometryStatus {
  positionError: number;
  headingError: number;
  distance: number;
  leftScale: number;
  rightScale: number;
  positionStd: number;
  headingStd: number;
  receivedAt: number;
}

export function parseOdometryStatus(data: unknown): OdometryStatus | null {
  if (typeof data !== 'string') return null;
  let value: Record<string, unknown>;
  try { value = JSON.parse(data); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = ['position_error_m', 'heading_error_rad', 'distance_m', 'left_scale',
    'right_scale', 'position_std_m', 'heading_std_rad'] as const;
  if (keys.some((key) => typeof value[key] !== 'number' || !Number.isFinite(value[key]))) return null;
  const numbers = keys.map((key) => value[key] as number);
  const [positionError, headingError, distance, leftScale, rightScale, positionStd, headingStd] = numbers;
  if ([positionError, distance, positionStd, headingStd].some((n) => n < 0) ||
      leftScale <= 0 || rightScale <= 0) return null;
  return { positionError, headingError, distance, leftScale, rightScale, positionStd,
    headingStd, receivedAt: performance.now() };
}

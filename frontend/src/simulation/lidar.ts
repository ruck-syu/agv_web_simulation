export interface LidarScan {
  ranges: (number | null)[];
  angleMin: number;
  angleIncrement: number;
  rangeMin: number;
  rangeMax: number;
  receivedAt: number;
}

/** rosbridge serializes non-finite ranges as null or strings; never coerce them to zero. */
export function parseScan(message: Record<string, unknown>): LidarScan | null {
  const header = message.header as Record<string, unknown> | undefined;
  const { angle_min: min, angle_increment: step, range_min: near, range_max: far } = message;
  if (header?.frame_id !== 'laser_frame' || !Array.isArray(message.ranges) ||
      message.ranges.length < 4 || message.ranges.length > 10000 ||
      typeof min !== 'number' || !Number.isFinite(min) ||
      typeof step !== 'number' || !Number.isFinite(step) || step <= 0 ||
      typeof near !== 'number' || !Number.isFinite(near) || near < 0 ||
      typeof far !== 'number' || !Number.isFinite(far) || far <= near) return null;
  return {
    ranges: message.ranges.map((value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value >= near && value <= far
        ? value : null),
    angleMin: min, angleIncrement: step, rangeMin: near, rangeMax: far,
    receivedAt: performance.now(),
  };
}

/** Close returns indicate proximity, including expected racks and walls. */
export function nearestReturn(scan: LidarScan | null): number | null {
  const ranges = scan?.ranges.filter((r): r is number => r !== null) ?? [];
  return ranges.length ? Math.min(...ranges) : null;
}

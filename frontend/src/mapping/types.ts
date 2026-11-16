export interface OccupancyMap {
  width: number;
  height: number;
  resolution: number;
  originX: number;
  originY: number;
  originYaw: number;
  data: number[];
  receivedAt: number;
}
export interface PlanarTransform { x: number; y: number; yaw: number; receivedAt: number }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
export function parseMap(message: Record<string, unknown>): OccupancyMap | null {
  if (record(message.header)?.frame_id !== 'map') return null;
  const info = record(message.info), origin = record(info?.origin);
  const position = record(origin?.position), orientation = record(origin?.orientation);
  const width = info?.width, height = info?.height, resolution = info?.resolution;
  if (!finite(width) || !finite(height) || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width * height > 1_000_000 ||
      !finite(resolution) || resolution <= 0 ||
      !finite(position?.x) || !finite(position?.y) ||
      !finite(orientation?.z) || !finite(orientation?.w) || Math.hypot(orientation.z, orientation.w) < 1e-8 ||
      !Array.isArray(message.data) || message.data.length !== width * height ||
      message.data.some((v) => !Number.isInteger(v) || v < -1 || v > 100)) return null;
  return { width, height, resolution, originX: position.x, originY: position.y,
    originYaw: 2 * Math.atan2(orientation.z, orientation.w), data: message.data,
    receivedAt: performance.now() };
}
export function parseMapTransform(message: Record<string, unknown>): PlanarTransform | null {
  if (!Array.isArray(message.transforms)) return null;
  for (const item of message.transforms) {
    const transform = record(item), header = record(transform?.header);
    if (header?.frame_id !== 'map' || transform?.child_frame_id !== 'odom') continue;
    const body = record(transform.transform), position = record(body?.translation), q = record(body?.rotation);
    if (!finite(position?.x) || !finite(position?.y) || !finite(q?.z) || !finite(q?.w) ||
        Math.hypot(q.z, q.w) < 1e-8) continue;
    return { x: position.x, y: position.y, yaw: 2 * Math.atan2(q.z, q.w), receivedAt: performance.now() };
  }
  return null;
}
export function transformPose(transform: PlanarTransform, pose: { x: number; y: number; yaw: number }) {
  const c = Math.cos(transform.yaw), s = Math.sin(transform.yaw);
  return { x: transform.x + c * pose.x - s * pose.y,
    y: transform.y + s * pose.x + c * pose.y, yaw: transform.yaw + pose.yaw };
}
export function mapPixel(map: OccupancyMap, x: number, y: number) {
  const dx = x - map.originX, dy = y - map.originY;
  return { x: (dx * Math.cos(map.originYaw) + dy * Math.sin(map.originYaw)) / map.resolution,
    y: map.height - (-dx * Math.sin(map.originYaw) + dy * Math.cos(map.originYaw)) / map.resolution };
}

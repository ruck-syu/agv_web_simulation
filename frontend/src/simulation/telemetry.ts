import type { RobotTelemetry } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function parseOdom(message: Record<string, unknown>, frame: string, child: string): RobotTelemetry | null {
  const header = asRecord(message.header);
  if (header?.frame_id !== frame || message.child_frame_id !== child) return null;
  const poseContainer = asRecord(message.pose);
  const pose = asRecord(poseContainer?.pose);
  const position = asRecord(pose?.position);
  const orientation = asRecord(pose?.orientation);
  const twistContainer = asRecord(message.twist);
  const twist = asRecord(twistContainer?.twist);
  const linear = asRecord(twist?.linear);
  const angular = asRecord(twist?.angular);
  if (!position || !orientation) return null;
  if ([position.x, position.y, orientation.x, orientation.y, orientation.z, orientation.w,
       linear?.x, angular?.z].some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null;
  const norm = Math.hypot(orientation.x as number, orientation.y as number,
    orientation.z as number, orientation.w as number);
  if (!Number.isFinite(norm) || norm < 1e-8) return null;

  const qx = asNumber(orientation.x) / norm;
  const qy = asNumber(orientation.y) / norm;
  const qz = asNumber(orientation.z) / norm;
  const qw = asNumber(orientation.w) / norm;
  const yaw = Math.atan2(
    2 * (qw * qz + qx * qy),
    1 - 2 * (qy * qy + qz * qz),
  );

  return {
    pose: {
      x: asNumber(position.x),
      y: asNumber(position.y),
      yaw,
    },
    linearVelocity: asNumber(linear?.x),
    angularVelocity: asNumber(angular?.z),
    leftWheelVelocity: 0,
    rightWheelVelocity: 0,
    leftWheelAngle: 0,
    rightWheelAngle: 0,
    hasJointState: false,
    poseReceivedAt: performance.now(),
    jointReceivedAt: 0,
    poseSequence: 0,
  };
}


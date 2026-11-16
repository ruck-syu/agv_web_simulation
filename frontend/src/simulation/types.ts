import type { OdometryStatus } from './odometry';
import type { RosConnectionStatus } from '../types/ros';

export type CollisionState = 'clear' | 'blocked' | 'contact' | 'unknown';

export type CollisionShape = 'box' | 'circle';

export interface CollisionObstacle {
  id: string;
  type: string;
  shape: CollisionShape;
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  yaw: number;
  zMin: number;
  zMax: number;
}

export interface CollisionGeometry {
  frameId: string;
  robot: {
    footprintLength: number;
    footprintWidth: number;
    footprintPadding: number;
    height: number;
  };
  obstacles: CollisionObstacle[];
  receivedAt: number;
}

export interface RobotPose {
  x: number;
  y: number;
  yaw: number;
}

export interface RobotTelemetry {
  pose: RobotPose;
  linearVelocity: number;
  angularVelocity: number;
  leftWheelVelocity: number;
  rightWheelVelocity: number;
  leftWheelAngle: number;
  rightWheelAngle: number;
  hasJointState: boolean;
  poseReceivedAt: number;
  jointReceivedAt: number;
  poseSequence: number;
}

export interface CollisionStatus {
  state: CollisionState;
  collision: boolean;
  blocked: boolean;
  blockedObjectId: string | null;
  blockedObjectType: string | null;
  contactX: number | null;
  contactY: number | null;
  lastObjectId: string | null;
  lastObjectType: string | null;
  lastBlockedAgeSec: number | null;
  motionState: string;
  commandActive: boolean;
  commandTimedOut: boolean;
  targetLinearVelocity: number;
  targetAngularVelocity: number;
  leftWheelVelocity: number;
  rightWheelVelocity: number;
  leftWheelLinearVelocity: number;
  rightWheelLinearVelocity: number;
  stamp: number;
  receivedAt: number;
}

export interface DriveCommand {
  linear: number;
  angular: number;
  at: number;
}

export interface SimulationSnapshot {
  wheelOdometry: RobotTelemetry | null;
  odometryStatus: OdometryStatus | null;
  telemetry: RobotTelemetry | null;
  collision: CollisionStatus;
  connectionStatus: RosConnectionStatus;
  stale: boolean;
  commandTxCount: number;
  commandError: string | null;
  lastCommand: DriveCommand | null;
}

export const EMPTY_COLLISION_STATUS: CollisionStatus = {
  state: 'unknown',
  collision: false,
  blocked: false,
  blockedObjectId: null,
  blockedObjectType: null,
  contactX: null,
  contactY: null,
  lastObjectId: null,
  lastObjectType: null,
  lastBlockedAgeSec: null,
  motionState: 'unknown',
  commandActive: false,
  commandTimedOut: false,
  targetLinearVelocity: 0,
  targetAngularVelocity: 0,
  leftWheelVelocity: 0,
  rightWheelVelocity: 0,
  leftWheelLinearVelocity: 0,
  rightWheelLinearVelocity: 0,
  stamp: 0,
  receivedAt: 0,
};

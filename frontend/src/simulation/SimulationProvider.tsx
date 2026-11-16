import { parseOdom } from './telemetry';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { parseOdometryStatus, type OdometryStatus } from './odometry';
import { APP_CONFIG } from '../config/appConfig';
import { useRos } from '../ros/RosProvider';
import type { RosConnectionStatus } from '../types/ros';
import {
  EMPTY_COLLISION_STATUS,
  type CollisionGeometry,
  type CollisionObstacle,
  type CollisionState,
  type CollisionStatus,
  type DriveCommand,
  type RobotTelemetry,
  type SimulationSnapshot,
} from './types';

interface SimulationContextValue {
  snapshot: SimulationSnapshot;
  sendTwist: (linear: number, angular: number) => boolean;
  stopRobot: () => boolean;
  getLatestTelemetry: () => RobotTelemetry | null;
  collisionGeometry: CollisionGeometry | null;
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}


function parseJointState(
  message: Record<string, unknown>,
  previous: RobotTelemetry | null,
): RobotTelemetry | null {
  if (!previous) return null;
  const names = Array.isArray(message.name) ? message.name : [];
  const positions = Array.isArray(message.position) ? message.position : [];
  const velocities = Array.isArray(message.velocity) ? message.velocity : [];

  let leftWheelAngle = previous.leftWheelAngle;
  let rightWheelAngle = previous.rightWheelAngle;
  let leftWheelVelocity = previous.leftWheelVelocity;
  let rightWheelVelocity = previous.rightWheelVelocity;
  let found = false;

  names.forEach((name, index) => {
    if (typeof name !== 'string') return;
    if (name === 'left_wheel_joint') {
      leftWheelAngle = asNumber(positions[index], leftWheelAngle);
      leftWheelVelocity = asNumber(velocities[index], leftWheelVelocity);
      found = true;
    }
    if (name === 'right_wheel_joint') {
      rightWheelAngle = asNumber(positions[index], rightWheelAngle);
      rightWheelVelocity = asNumber(velocities[index], rightWheelVelocity);
      found = true;
    }
  });

  if (!found) return null;
  return {
    ...previous,
    leftWheelAngle,
    rightWheelAngle,
    leftWheelVelocity,
    rightWheelVelocity,
    hasJointState: true,
    jointReceivedAt: performance.now(),
  };
}

function parseCollisionStatus(data: string): CollisionStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record) return null;

  const rawState = record.state;
  const state: CollisionState =
    rawState === 'clear' || rawState === 'blocked' || rawState === 'contact'
      ? rawState
      : 'unknown';

  return {
    state,
    collision: record.collision === true,
    blocked: record.blocked === true,
    blockedObjectId: asNullableString(record.blocked_object_id),
    blockedObjectType: asNullableString(record.blocked_object_type),
    contactX: asNullableNumber(record.contact_x),
    contactY: asNullableNumber(record.contact_y),
    lastObjectId: asNullableString(record.last_object_id),
    lastObjectType: asNullableString(record.last_object_type),
    lastBlockedAgeSec: asNullableNumber(record.last_blocked_age_sec),
    motionState: asNullableString(record.motion_state) ?? 'unknown',
    commandActive: record.command_active === true,
    commandTimedOut: record.command_timed_out === true,
    targetLinearVelocity: asNumber(record.target_linear_velocity),
    targetAngularVelocity: asNumber(record.target_angular_velocity),
    leftWheelVelocity: asNumber(record.left_wheel_velocity),
    rightWheelVelocity: asNumber(record.right_wheel_velocity),
    leftWheelLinearVelocity: asNumber(record.left_wheel_linear_velocity),
    rightWheelLinearVelocity: asNumber(record.right_wheel_linear_velocity),
    stamp: asNumber(record.stamp),
    receivedAt: performance.now(),
  };
}

function parseCollisionGeometry(data: string): CollisionGeometry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  const robot = asRecord(record?.robot);
  const rawObstacles = Array.isArray(record?.obstacles) ? record.obstacles : [];
  if (!robot) return null;

  const obstacles: CollisionObstacle[] = [];
  for (const value of rawObstacles) {
    const item = asRecord(value);
    if (!item) continue;
    const id = asNullableString(item.id);
    const type = asNullableString(item.type);
    if (!id || !type) continue;
    obstacles.push({
      id,
      type,
      shape: item.shape === 'circle' ? 'circle' : 'box',
      cx: asNumber(item.cx),
      cy: asNumber(item.cy),
      hx: asNumber(item.hx, 0.1),
      hy: asNumber(item.hy, 0.1),
      yaw: asNumber(item.yaw),
      zMin: asNumber(item.z_min, 0),
      zMax: asNumber(item.z_max, 10),
    });
  }

  return {
    frameId: asNullableString(record?.frame_id) ?? 'world',
    robot: {
      footprintLength: asNumber(robot.footprint_length, 1.55),
      footprintWidth: asNumber(robot.footprint_width, 1.06),
      footprintPadding: asNumber(robot.footprint_padding, 0),
      height: asNumber(robot.height, 0.96),
    },
    obstacles,
    receivedAt: performance.now(),
  };
}

export function SimulationProvider({ children }: { children: ReactNode }) {
  const { state, subscribe, publish, appendLog } = useRos();
  const telemetryRef = useRef<RobotTelemetry | null>(null);
  const wheelOdometryRef = useRef<RobotTelemetry | null>(null);
  const odometryStatusRef = useRef<OdometryStatus | null>(null);
  const collisionRef = useRef<CollisionStatus>(EMPTY_COLLISION_STATUS);
  const statusRef = useRef<RosConnectionStatus>(state.status);
  const lastCommandRef = useRef<DriveCommand | null>(null);
  const commandTxCountRef = useRef(0);
  const commandErrorRef = useRef<string | null>(null);
  const poseSequenceRef = useRef(0);
  const firstTruthLoggedRef = useRef(false);
  const collisionLogRef = useRef({ blocked: false, timedOut: false });
  const collisionParseWarningRef = useRef(false);

  statusRef.current = state.status;

  const buildSnapshot = useCallback((): SimulationSnapshot => {
    const telemetry = telemetryRef.current;
    const stale =
      telemetry === null ||
      performance.now() - telemetry.poseReceivedAt > APP_CONFIG.simulation.staleAfterMs;

    return {
      telemetry,
      wheelOdometry: wheelOdometryRef.current,
      odometryStatus: odometryStatusRef.current,
      collision: collisionRef.current,
      connectionStatus: statusRef.current,
      stale,
      commandTxCount: commandTxCountRef.current,
      commandError: commandErrorRef.current,
      lastCommand: lastCommandRef.current,
    };
  }, []);

  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(buildSnapshot);
  const [collisionGeometry, setCollisionGeometry] = useState<CollisionGeometry | null>(
    null,
  );

  useEffect(() => {
    const truthTopic = APP_CONFIG.ros.topics.groundTruth;
    const odomTopic = APP_CONFIG.ros.topics.odom;
    const jointTopic = APP_CONFIG.ros.topics.jointStates;
    const collisionTopic = APP_CONFIG.ros.topics.collisionStatus;
    const geometryTopic = APP_CONFIG.ros.topics.collisionGeometry;

    const truthSubscription = subscribe(
      truthTopic.name,
      truthTopic.messageType,
      (message) => {
        const parsed = parseOdom(message, 'world', 'ground_truth_base_link');
        if (!parsed) return;
        poseSequenceRef.current += 1;
        const previous = telemetryRef.current;
        telemetryRef.current = {
          ...parsed,
          leftWheelVelocity: previous?.leftWheelVelocity ?? 0,
          rightWheelVelocity: previous?.rightWheelVelocity ?? 0,
          leftWheelAngle: previous?.leftWheelAngle ?? 0,
          rightWheelAngle: previous?.rightWheelAngle ?? 0,
          hasJointState: previous?.hasJointState ?? false,
          jointReceivedAt: previous?.jointReceivedAt ?? 0,
          poseSequence: poseSequenceRef.current,
        };
        if (!firstTruthLoggedRef.current) {
          firstTruthLoggedRef.current = true;
          appendLog('success', 'SIM', 'Authoritative pose received from /agv_web/ground_truth.');
        }
      },
    );

    const odomSubscription = subscribe(odomTopic.name, odomTopic.messageType, (message) => {
      const parsed = parseOdom(message, 'odom', 'base_link');
      if (parsed) wheelOdometryRef.current = parsed;
    });
    const odometryStatusSubscription = subscribe(
      APP_CONFIG.ros.topics.odometryStatus.name,
      APP_CONFIG.ros.topics.odometryStatus.messageType,
      (message) => {
        const parsed = parseOdometryStatus(message.data);
        if (parsed) odometryStatusRef.current = parsed;
      },
    );

    const jointSubscription = subscribe(
      jointTopic.name,
      jointTopic.messageType,
      (message) => {
        const parsed = parseJointState(message, telemetryRef.current);
        if (parsed) telemetryRef.current = parsed;
      },
    );

    const collisionSubscription = subscribe(
      collisionTopic.name,
      collisionTopic.messageType,
      (message) => {
        const data = message.data;
        if (typeof data !== 'string') return;
        const parsed = parseCollisionStatus(data);
        if (!parsed) {
          if (!collisionParseWarningRef.current) {
            collisionParseWarningRef.current = true;
            appendLog('warning', 'SAFETY', 'Ignored malformed collision status payload.');
          }
          return;
        }
        collisionRef.current = parsed;
        const previous = collisionLogRef.current;
        if (parsed.blocked && !previous.blocked) {
          appendLog(
            'warning',
            'SAFETY',
            `Movement blocked by ${parsed.blockedObjectId ?? 'unknown obstacle'}${
              parsed.blockedObjectType ? ` (${parsed.blockedObjectType})` : ''
            }.`,
          );
        } else if (!parsed.blocked && previous.blocked && parsed.state === 'clear') {
          appendLog('success', 'SAFETY', 'Collision path clear; movement resumed.');
        }
        if (parsed.commandTimedOut && !previous.timedOut) {
          appendLog(
            'warning',
            'SAFETY',
            `No /cmd_vel for ${(APP_CONFIG.simulation.commandTimeoutMs / 1000).toFixed(1)}s; robot stopped by the backend.`,
          );
        }
        collisionLogRef.current = {
          blocked: parsed.blocked,
          timedOut: parsed.commandTimedOut,
        };
      },
    );

    const geometrySubscription = subscribe(
      geometryTopic.name,
      geometryTopic.messageType,
      (message) => {
        const data = message.data;
        if (typeof data !== 'string') return;
        const parsed = parseCollisionGeometry(data);
        if (parsed) setCollisionGeometry(parsed);
      },
    );

    return () => {
      truthSubscription.unsubscribe();
      odomSubscription.unsubscribe();
      odometryStatusSubscription.unsubscribe();
      jointSubscription.unsubscribe();
      collisionSubscription.unsubscribe();
      geometrySubscription.unsubscribe();
    };
  }, [appendLog, subscribe]);

  useEffect(() => {
    setSnapshot(buildSnapshot());
    const timer = window.setInterval(() => {
      setSnapshot(buildSnapshot());
    }, APP_CONFIG.simulation.uiRefreshMs);
    return () => window.clearInterval(timer);
  }, [buildSnapshot]);

  useEffect(() => {
    if (state.status !== 'connected') {
      telemetryRef.current = null;
      wheelOdometryRef.current = null;
      odometryStatusRef.current = null;
      firstTruthLoggedRef.current = false;
      setSnapshot(buildSnapshot());
    }
  }, [state.status, buildSnapshot]);

  const sendTwist = useCallback(
    (linear: number, angular: number): boolean => {
      if (!Number.isFinite(linear) || !Number.isFinite(angular)) return false;
      const topic = APP_CONFIG.ros.topics.cmdVel;
      const clampedLinear = Math.max(
        -APP_CONFIG.simulation.maxLinearSpeed,
        Math.min(APP_CONFIG.simulation.maxLinearSpeed, linear),
      );
      const clampedAngular = Math.max(
        -APP_CONFIG.simulation.maxAngularSpeed,
        Math.min(APP_CONFIG.simulation.maxAngularSpeed, angular),
      );
      try {
        publish(topic.name, topic.messageType, {
          linear: { x: clampedLinear, y: 0, z: 0 },
          angular: { x: 0, y: 0, z: clampedAngular },
        });
        commandTxCountRef.current += 1;
        commandErrorRef.current = null;
        lastCommandRef.current = {
          linear: clampedLinear,
          angular: clampedAngular,
          at: performance.now(),
        };
        return true;
      } catch (error) {
        commandErrorRef.current =
          error instanceof Error ? error.message : 'Unable to publish /cmd_vel.';
        return false;
      }
    },
    [publish],
  );

  const stopRobot = useCallback(() => sendTwist(0, 0), [sendTwist]);

  const getLatestTelemetry = useCallback(() => telemetryRef.current, []);

  useEffect(() => {
    const stopOnUnload = () => {
      try {
        sendTwist(0, 0);
      } catch {
        return;
      }
    };
    window.addEventListener('beforeunload', stopOnUnload);
    return () => {
      window.removeEventListener('beforeunload', stopOnUnload);
      stopOnUnload();
    };
  }, [sendTwist]);

  const value = useMemo<SimulationContextValue>(
    () => ({
      snapshot,
      sendTwist,
      stopRobot,
      getLatestTelemetry,
      collisionGeometry,
    }),
    [collisionGeometry, getLatestTelemetry, sendTwist, snapshot, stopRobot],
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation(): SimulationContextValue {
  const context = useContext(SimulationContext);
  if (!context) {
    throw new Error('useSimulation must be used inside SimulationProvider.');
  }
  return context;
}

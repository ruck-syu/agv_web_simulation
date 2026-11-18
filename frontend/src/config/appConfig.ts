export interface RosTopicConfig {
  name: string;
  messageType: string;
}

function readEndpoint(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export const APP_CONFIG = {
  rosbridgeUrl: readEndpoint(import.meta.env.VITE_ROSBRIDGE_URL, 'ws://localhost:9090'),
  ros: {
    autoConnect: true,
    connectionTimeoutMs: 7000,
    reconnect: {
      baseDelayMs: 2000,
      maxDelayMs: 15000,
      maxAttempts: 0,
    },
    topics: {
      groundTruth: { name: '/agv_web/ground_truth', messageType: 'nav_msgs/msg/Odometry' } satisfies RosTopicConfig,
      odometryStatus: { name: '/agv_web/odometry_status', messageType: 'std_msgs/msg/String' } satisfies RosTopicConfig,
      scan: { name: '/scan', messageType: 'sensor_msgs/msg/LaserScan' } satisfies RosTopicConfig,
      cmdVel: {
        name: '/agv_web/manual_cmd_vel',
        messageType: 'geometry_msgs/msg/Twist',
      } satisfies RosTopicConfig,
      odom: {
        name: '/odom',
        messageType: 'nav_msgs/msg/Odometry',
      } satisfies RosTopicConfig,
      jointStates: {
        name: '/joint_states',
        messageType: 'sensor_msgs/msg/JointState',
      } satisfies RosTopicConfig,
      collisionStatus: {
        name: '/agv_web/collision_status',
        messageType: 'std_msgs/msg/String',
      } satisfies RosTopicConfig,
      collisionGeometry: {
        name: '/agv_web/collision_geometry',
        messageType: 'std_msgs/msg/String',
      } satisfies RosTopicConfig,
    },
    maxLogEntries: 250,
  },
  simulation: {
    staleAfterMs: 1500,
    uiRefreshMs: 100,
    cmdPublishIntervalMs: 100,
    defaultLinearSpeed: 0.7,
    defaultAngularSpeed: 0.6,
    maxLinearSpeed: 1.2,
    maxAngularSpeed: 1.2,
    commandTimeoutMs: 250,
  },
} as const;

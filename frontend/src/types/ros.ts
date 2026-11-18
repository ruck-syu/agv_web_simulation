export type RosConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type RosLogLevel = 'info' | 'success' | 'warning' | 'error' | 'system';

export interface RosLogEntry {
  id: string;
  timestamp: string;
  level: RosLogLevel;
  source: string;
  message: string;
}

export interface RosBridgeState {
  status: RosConnectionStatus;
  endpoint: string;
  reconnectAttempt: number;
  lastError: string | null;
}

export interface RosBridgeClientOptions {
  autoReconnect?: boolean;
  connectionTimeoutMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectMaxAttempts?: number;
}

export interface RosSubscriptionHandle {
  unsubscribe: () => void;
}

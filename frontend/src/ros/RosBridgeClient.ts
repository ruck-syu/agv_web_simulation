import type {
  RosBridgeClientOptions,
  RosBridgeState,
  RosConnectionStatus,
  RosLogEntry,
  RosLogLevel,
  RosSubscriptionHandle,
} from '../types/ros';
import { createRosLogEntry } from './logging';

interface SubscriptionEntry {
  id: string;
  topic: string;
  messageType: string;
  callback: (message: Record<string, unknown>) => void;
}

interface RosbridgeIncomingMessage {
  op?: string;
  topic?: string;
  msg?: Record<string, unknown>;
  level?: string;
  message?: string;
}

const WS_OPEN = 1;
const WS_CONNECTING = 0;

/**
 * Small ROS 2 rosbridge WebSocket transport.
 *
 * This intentionally implements only the rosbridge operations used by the
 * dashboard (advertise, subscribe, unsubscribe and publish). Keeping the
 * transport isolated means future simulation panels can reuse it without
 * coupling ROS logic to React components.
 */
export class RosBridgeClient {
  private readonly endpoint: string;
  private readonly autoReconnect: boolean;
  private readonly connectionTimeoutMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly reconnectMaxAttempts: number;

  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;
  private idCounter = 0;

  private state: RosBridgeState;
  private readonly stateListeners = new Set<(state: RosBridgeState) => void>();
  private readonly logListeners = new Set<(entry: RosLogEntry) => void>();
  private readonly subscriptions = new Map<string, SubscriptionEntry>();
  private readonly advertisedTopics = new Map<string, string>();

  constructor(endpoint: string, options: RosBridgeClientOptions = {}) {
    this.endpoint = endpoint;
    this.autoReconnect = options.autoReconnect ?? true;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 7000;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 2000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 15000;
    this.reconnectMaxAttempts = options.reconnectMaxAttempts ?? 0;

    this.state = {
      status: 'disconnected',
      endpoint,
      reconnectAttempt: 0,
      lastError: null,
    };
  }

  getState(): RosBridgeState {
    return this.state;
  }

  onStateChange(listener: (state: RosBridgeState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onLog(listener: (entry: RosLogEntry) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  connect(): void {
    if (this.socket && (this.socket.readyState === WS_OPEN || this.socket.readyState === WS_CONNECTING)) {
      return;
    }

    this.intentionalDisconnect = false;
    this.clearReconnectTimer();
    this.clearConnectionTimer();
    this.socket = null;

    if (typeof WebSocket === 'undefined') {
      this.failConnection('This browser does not expose the WebSocket API.');
      return;
    }

    this.updateState({
      ...this.state,
      status: 'connecting',
      lastError: null,
    });
    this.log('info', 'CLIENT', `Connecting to rosbridge at ${this.endpoint}`);

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.endpoint);
    } catch (error) {
      this.failConnection(error instanceof Error ? error.message : 'Unable to open the ROS WebSocket.');
      return;
    }

    this.socket = socket;

    this.connectionTimer = setTimeout(() => {
      if (this.socket !== socket || socket.readyState === WS_OPEN) return;
      this.failConnection(
        `Connection timed out after ${Math.round(this.connectionTimeoutMs / 1000)} seconds.`,
        socket,
      );
    }, this.connectionTimeoutMs);

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.clearConnectionTimer();
      this.updateState({
        ...this.state,
        status: 'connected',
        reconnectAttempt: 0,
        lastError: null,
      });
      this.log('success', 'CLIENT', `WebSocket connected to ${this.endpoint}`);
      this.restoreRosbridgeChannels(socket);
    };

    socket.onerror = () => {
      if (this.socket !== socket) return;
      this.failConnection(
        'WebSocket error. Is rosbridge running and reachable?',
        socket,
      );
    };

    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearConnectionTimer();

      if (this.intentionalDisconnect) {
        this.updateState({
          ...this.state,
          status: 'disconnected',
          reconnectAttempt: 0,
        });
        this.log('info', 'CLIENT', 'ROS bridge connection closed by the dashboard.');
        return;
      }

      const reason = event.reason ? ` ${event.reason}` : '';
      this.failConnection(
        `Connection closed unexpectedly (code ${event.code}).${reason}`.trim(),
      );
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleIncomingMessage(event.data);
    };
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    this.clearConnectionTimer();

    const socket = this.socket;
    this.socket = null;

    if (socket) {
      try {
        socket.close();
      } catch {
        // The browser may already have invalidated the socket.
      }
    }

    this.updateState({
      ...this.state,
      status: 'disconnected',
      reconnectAttempt: 0,
      lastError: null,
    });
    this.log('info', 'CLIENT', 'Disconnected from rosbridge.');
  }

  subscribe(
    topic: string,
    messageType: string,
    callback: (message: Record<string, unknown>) => void,
  ): RosSubscriptionHandle {
    const id = `sub:${++this.idCounter}`;
    const entry: SubscriptionEntry = { id, topic, messageType, callback };
    this.subscriptions.set(id, entry);

    if (this.isOpen()) {
      this.sendSubscription(entry);
      this.log('info', 'ROS', `Subscribed to ${topic} (${messageType})`);
    } else {
      this.log('info', 'ROS', `Subscription queued for ${topic} until ROS connects.`);
    }

    return {
      unsubscribe: () => {
        const active = this.subscriptions.get(id);
        if (!active) return;
        this.subscriptions.delete(id);
        if (this.isOpen()) {
          this.socket?.send(
            JSON.stringify({
              op: 'unsubscribe',
              id,
              topic: active.topic,
            }),
          );
          this.log('info', 'ROS', `Unsubscribed from ${active.topic}`);
        }
      },
    };
  }

  publish(topic: string, messageType: string, message: Record<string, unknown>): void {
    if (!this.isOpen()) {
      throw new Error('ROS bridge is not connected.');
    }

    if (!this.advertisedTopics.has(topic)) {
      this.advertisedTopics.set(topic, messageType);
      this.sendAdvertise(topic, messageType);
    }

    this.socket?.send(
      JSON.stringify({
        op: 'publish',
        topic,
        msg: message,
      }),
    );
  }

  private isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WS_OPEN;
  }

  private restoreRosbridgeChannels(socket: WebSocket): void {
    for (const [topic, messageType] of this.advertisedTopics) {
      this.sendAdvertise(topic, messageType);
    }

    for (const subscription of this.subscriptions.values()) {
      this.sendSubscription(subscription);
    }

    if (this.subscriptions.size > 0) {
      this.log(
        'info',
        'ROS',
        `Restored ${this.subscriptions.size} subscription(s) after reconnecting.`,
      );
    }

    if (socket.readyState !== WS_OPEN) return;
  }

  private sendAdvertise(topic: string, messageType: string): void {
    if (!this.isOpen()) return;
    this.socket?.send(
      JSON.stringify({
        op: 'advertise',
        id: `advertise:${++this.idCounter}`,
        topic,
        type: messageType,
      }),
    );
  }

  private sendSubscription(entry: SubscriptionEntry): void {
    this.socket?.send(
      JSON.stringify({
        op: 'subscribe',
        id: entry.id,
        topic: entry.topic,
        type: entry.messageType,
        queue_length: 1,
        throttle_rate: 0,
      }),
    );
  }

  private handleIncomingMessage(rawData: string): void {
    let payload: RosbridgeIncomingMessage;
    try {
      payload = JSON.parse(rawData) as RosbridgeIncomingMessage;
    } catch {
      this.log('warning', 'ROS', 'Ignored a malformed rosbridge message.');
      return;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

    if (payload.op === 'publish' && typeof payload.topic === 'string' && payload.msg) {
      for (const subscription of this.subscriptions.values()) {
        if (subscription.topic !== payload.topic) continue;
        try {
          subscription.callback(payload.msg);
        } catch (error) {
          this.log(
            'error',
            'ROS',
            `Consumer for ${payload.topic} failed: ${
              error instanceof Error ? error.message : 'unknown callback error'
            }`,
          );
        }
      }
      return;
    }

    if (payload.op === 'status') {
      const level = payload.level === 'error' ? 'error' : 'warning';
      this.log(level, 'BROKER', payload.message ?? 'Rosbridge reported an unknown status.');
    }
  }

  private failConnection(message: string, socketToClose?: WebSocket): void {
    const socket = socketToClose ?? this.socket;
    this.socket = null;
    this.clearConnectionTimer();
    this.clearReconnectTimer();

    if (socket) {
      socket.onopen = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.onmessage = null;
      try {
        socket.close();
      } catch {
        // Ignore cleanup failures.
      }
    }

    this.log('error', 'CLIENT', message);
    this.updateState({
      ...this.state,
      status: 'error',
      lastError: message,
    });

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.autoReconnect || this.intentionalDisconnect) return;

    if (this.reconnectMaxAttempts > 0 && this.state.reconnectAttempt >= this.reconnectMaxAttempts) {
      this.log(
        'error',
        'CLIENT',
        `Automatic reconnect stopped after ${this.reconnectMaxAttempts} attempts.`,
      );
      return;
    }

    const attempt = this.state.reconnectAttempt + 1;
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** (attempt - 1),
      this.reconnectMaxDelayMs,
    );

    this.updateState({
      ...this.state,
      status: 'error',
      reconnectAttempt: attempt,
    });
    this.log(
      'warning',
      'CLIENT',
      `Retrying connection in ${(delay / 1000).toFixed(0)}s (attempt ${attempt}).`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.log('info', 'CLIENT', `Reconnect attempt ${attempt} starting.`);
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearConnectionTimer(): void {
    if (this.connectionTimer !== null) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  private updateState(nextState: RosBridgeState): void {
    this.state = nextState;
    for (const listener of this.stateListeners) {
      listener(this.state);
    }
  }

  private log(level: RosLogLevel, source: string, message: string): void {
    const entry = createRosLogEntry(level, source, message);
    for (const listener of this.logListeners) {
      listener(entry);
    }
  }
}

export function getStatusLabel(status: RosConnectionStatus): string {
  const labels: Record<RosConnectionStatus, string> = {
    connected: 'Connected',
    connecting: 'Connecting',
    disconnected: 'Disconnected',
    error: 'Connection error',
  };
  return labels[status];
}

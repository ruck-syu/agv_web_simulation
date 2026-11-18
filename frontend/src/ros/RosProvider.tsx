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
import { APP_CONFIG } from '../config/appConfig';
import { RosBridgeClient } from './RosBridgeClient';
import { createRosLogEntry } from './logging';
import type {
  RosBridgeState,
  RosLogEntry,
  RosLogLevel,
  RosSubscriptionHandle,
} from '../types/ros';

interface RosContextValue {
  state: RosBridgeState;
  logs: RosLogEntry[];
  connect: () => void;
  disconnect: () => void;
  retryNow: () => void;
  clearLogs: () => void;
  subscribe: (
    topic: string,
    messageType: string,
    callback: (message: Record<string, unknown>) => void,
  ) => RosSubscriptionHandle;
  publish: (topic: string, messageType: string, message: Record<string, unknown>) => void;
  appendLog: (level: RosLogLevel, source: string, message: string) => void;
}

const RosContext = createContext<RosContextValue | null>(null);

export function RosProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<RosBridgeClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new RosBridgeClient(APP_CONFIG.rosbridgeUrl, {
      autoReconnect: true,
      connectionTimeoutMs: APP_CONFIG.ros.connectionTimeoutMs,
      reconnectBaseDelayMs: APP_CONFIG.ros.reconnect.baseDelayMs,
      reconnectMaxDelayMs: APP_CONFIG.ros.reconnect.maxDelayMs,
      reconnectMaxAttempts: APP_CONFIG.ros.reconnect.maxAttempts,
    });
  }

  const client = clientRef.current;
  const [state, setState] = useState<RosBridgeState>(() => client.getState());
  const [logs, setLogs] = useState<RosLogEntry[]>([]);
  const appendLog = useCallback(
    (level: RosLogLevel, source: string, message: string) => {
      setLogs((previous) =>
        [...previous, createRosLogEntry(level, source, message)].slice(
          -APP_CONFIG.ros.maxLogEntries,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    const unsubscribeState = client.onStateChange(setState);
    const unsubscribeLog = client.onLog((entry) => {
      setLogs((previous) => [...previous, entry].slice(-APP_CONFIG.ros.maxLogEntries));
    });

    if (APP_CONFIG.ros.autoConnect) {
      client.connect();
    }

    return () => {
      unsubscribeState();
      unsubscribeLog();
      client.disconnect();
    };
  }, [appendLog, client]);

  const connect = useCallback(() => {
    appendLog('info', 'WEB', 'Manual ROS connection requested.');
    client.connect();
  }, [appendLog, client]);

  const disconnect = useCallback(() => {
    appendLog('info', 'WEB', 'Manual ROS disconnection requested.');
    client.disconnect();
  }, [appendLog, client]);

  const retryNow = useCallback(() => {
    appendLog('info', 'WEB', 'Immediate reconnect requested by the operator.');
    client.disconnect();
    client.connect();
  }, [appendLog, client]);

  const clearLogs = useCallback(() => {
    setLogs([]);
    appendLog('system', 'WEB', 'Communication log cleared by the operator.');
  }, [appendLog]);

  const subscribe = useCallback(
    (
      topic: string,
      messageType: string,
      callback: (message: Record<string, unknown>) => void,
    ) => client.subscribe(topic, messageType, callback),
    [client],
  );

  const publish = useCallback(
    (topic: string, messageType: string, message: Record<string, unknown>) => {
      client.publish(topic, messageType, message);
    },
    [client],
  );

  const value = useMemo<RosContextValue>(
    () => ({
      state,
      logs,
      connect,
      disconnect,
      retryNow,
      clearLogs,
      subscribe,
      publish,
      appendLog,
    }),
    [
      state,
      logs,
      connect,
      disconnect,
      retryNow,
      clearLogs,
      subscribe,
      publish,
      appendLog,
    ],
  );

  return <RosContext.Provider value={value}>{children}</RosContext.Provider>;
}

export function useRos(): RosContextValue {
  const context = useContext(RosContext);
  if (!context) {
    throw new Error('useRos must be used inside RosProvider.');
  }
  return context;
}

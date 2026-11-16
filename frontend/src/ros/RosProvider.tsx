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
  ReceivedRosMessage,
  RosBridgeState,
  RosLogEntry,
  RosLogLevel,
  RosSubscriptionHandle,
  SendMessageResult,
} from '../types/ros';

interface RosContextValue {
  state: RosBridgeState;
  logs: RosLogEntry[];
  latestTestMessage: ReceivedRosMessage | null;
  latestAck: ReceivedRosMessage | null;
  receivedCount: number;
  sentCount: number;
  connect: () => void;
  disconnect: () => void;
  retryNow: () => void;
  sendTestMessage: (data: string) => SendMessageResult;
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
  const [latestTestMessage, setLatestTestMessage] = useState<ReceivedRosMessage | null>(null);
  const [latestAck, setLatestAck] = useState<ReceivedRosMessage | null>(null);
  const [receivedCount, setReceivedCount] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const receiveSequence = useRef(0);

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

    const testTopic = APP_CONFIG.ros.topics.testFromRos;
    const ackTopic = APP_CONFIG.ros.topics.testAck;

    const testSubscription = client.subscribe(
      testTopic.name,
      testTopic.messageType,
      (message) => {
        const data = message.data;
        if (typeof data !== 'string') {
          appendLog('warning', 'RX', `Received a ${testTopic.name} message without string data.`);
          return;
        }

        receiveSequence.current += 1;
        const received: ReceivedRosMessage = {
          data,
          receivedAt: new Date().toISOString(),
          sequence: receiveSequence.current,
        };
        setLatestTestMessage(received);
        setReceivedCount((count) => count + 1);
        appendLog('info', 'RX', `${testTopic.name} → ${data}`);
      },
    );

    const ackSubscription = client.subscribe(
      ackTopic.name,
      ackTopic.messageType,
      (message) => {
        const data = message.data;
        if (typeof data !== 'string') {
          appendLog('warning', 'RX', `Received a ${ackTopic.name} message without string data.`);
          return;
        }

        receiveSequence.current += 1;
        const received: ReceivedRosMessage = {
          data,
          receivedAt: new Date().toISOString(),
          sequence: receiveSequence.current,
        };
        setLatestAck(received);
        appendLog('success', 'RX', `${ackTopic.name} → ${data}`);
      },
    );

    if (APP_CONFIG.ros.autoConnect) {
      client.connect();
    }

    return () => {
      testSubscription.unsubscribe();
      ackSubscription.unsubscribe();
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

  const sendTestMessage = useCallback(
    (data: string): SendMessageResult => {
      const payload = data.trim();
      if (!payload) {
        return { ok: false, error: 'Enter a message before publishing.' };
      }

      const target = APP_CONFIG.ros.topics.testToRos;
      try {
        client.publish(target.name, target.messageType, { data: payload });
        setSentCount((count) => count + 1);
        appendLog('success', 'TX', `${target.name} ← ${payload}`);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Publish failed.';
        appendLog('error', 'TX', `Failed to publish to ${target.name}: ${message}`);
        return { ok: false, error: message };
      }
    },
    [appendLog, client],
  );

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
      latestTestMessage,
      latestAck,
      receivedCount,
      sentCount,
      connect,
      disconnect,
      retryNow,
      sendTestMessage,
      clearLogs,
      subscribe,
      publish,
      appendLog,
    }),
    [
      state,
      logs,
      latestTestMessage,
      latestAck,
      receivedCount,
      sentCount,
      connect,
      disconnect,
      retryNow,
      sendTestMessage,
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

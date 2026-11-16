import { useEffect, useRef } from 'react';
import { useRos } from '../ros/RosProvider';
import type { RosSubscriptionHandle } from '../types/ros';

/**
 * Reusable subscription hook for future LiDAR, odometry, camera and Nav2
 * topics. The latest handler is stored in a ref so a callback render does not
 * churn the underlying rosbridge subscription.
 */
export function useRosTopic<T extends Record<string, unknown>>(
  topic: string,
  messageType: string,
  handler: (message: T) => void,
  enabled = true,
): void {
  const { subscribe } = useRos();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    const handle: RosSubscriptionHandle = subscribe(topic, messageType, (message) => {
      handlerRef.current(message as T);
    });
    return () => handle.unsubscribe();
  }, [enabled, messageType, subscribe, topic]);
}

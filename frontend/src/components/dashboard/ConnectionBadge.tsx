import { useRos } from '../../ros/RosProvider';
import type { RosConnectionStatus } from '../../types/ros';
import { getStatusLabel } from '../../ros/RosBridgeClient';

const TONE_BY_STATUS: Record<
  RosConnectionStatus,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  connected: 'success',
  connecting: 'warning',
  error: 'danger',
  disconnected: 'neutral',
};

interface ConnectionBadgeProps {
  compact?: boolean;
  showEndpoint?: boolean;
}

export function ConnectionBadge({
  compact = false,
  showEndpoint = false,
}: ConnectionBadgeProps) {
  const { state } = useRos();
  const tone = TONE_BY_STATUS[state.status];

  return (
    <span
      className={`connection-badge connection-badge--${tone} ${
        state.status === 'connecting' ? 'is-pulsing' : ''
      }`}
      title={
        state.lastError
          ? `${getStatusLabel(state.status)} — ${state.lastError}`
          : `ROS bridge ${state.endpoint}`
      }
    >
      <span className="connection-badge__indicator" aria-hidden="true" />
      <span className="connection-badge__text">
        <span className="connection-badge__label">ROS {getStatusLabel(state.status)}</span>
        {!compact && showEndpoint && (
          <span className="connection-badge__endpoint">{state.endpoint}</span>
        )}
      </span>
    </span>
  );
}

export { TONE_BY_STATUS };

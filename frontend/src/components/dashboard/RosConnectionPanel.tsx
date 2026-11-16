import { useRos } from '../../ros/RosProvider';
import { ConnectionBadge } from './ConnectionBadge';
import { FieldRow } from '../ui/FieldRow';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';

export function RosConnectionPanel() {
  const { state, connect, disconnect, retryNow } = useRos();

  const isActive = state.status === 'connected' || state.status === 'connecting';

  return (
    <Panel
      eyebrow="Connection"
      title="ROS bridge"
      className="ros-connection-panel"
      actions={<ConnectionBadge compact />}
    >
      <div className="connection-detail">
        <FieldRow label="WebSocket" value={state.endpoint} mono />
        <FieldRow label="Transport" value="rosbridge_suite" />
        <FieldRow label="Protocol" value="rosbridge JSON over WebSocket" />
        <FieldRow
          label="Auto-retry"
          value={
            state.reconnectAttempt > 0
              ? `Attempt ${state.reconnectAttempt} scheduled`
              : 'Enabled · 2–15 s backoff'
          }
        />
        <FieldRow
          label="Last error"
          value={state.lastError ?? 'None'}
          title={state.lastError ?? undefined}
        />
      </div>

      <div className="button-row">
        {isActive ? (
          <button type="button" className="button button--danger" onClick={disconnect}>
            <Icon name="wifi-off" size={16} />
            Disconnect
          </button>
        ) : (
          <button type="button" className="button button--primary" onClick={retryNow}>
            <Icon name="wifi" size={16} />
            Connect now
          </button>
        )}
        <button
          type="button"
          className="button button--ghost"
          onClick={connect}
          disabled={state.status === 'connected' || state.status === 'connecting'}
        >
          {state.status === 'connected' ? 'Connected' : 'Open socket'}
        </button>
      </div>
    </Panel>
  );
}

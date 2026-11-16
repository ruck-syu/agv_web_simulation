import { useState, type FormEvent } from 'react';
import { APP_CONFIG } from '../../config/appConfig';
import { useRos } from '../../ros/RosProvider';
import { formatMessageTime } from '../../ros/logging';
import { FieldRow } from '../ui/FieldRow';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';

export function RosTestPanel() {
  const {
    state,
    latestTestMessage,
    latestAck,
    receivedCount,
    sentCount,
    sendTestMessage,
  } = useRos();
  const [message, setMessage] = useState<string>(APP_CONFIG.ros.testMessageDefault);
  const [error, setError] = useState<string | null>(null);
  const isConnected = state.status === 'connected';

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = sendTestMessage(message);
    setError(result.ok ? null : (result.error ?? 'Publish failed.'));
  };

  return (
    <Panel
      eyebrow="Bidirectional test"
      title="ROS communication"
      className="ros-test-panel"
      actions={<StatusBadge tone={isConnected ? 'success' : 'neutral'}>{isConnected ? 'Live' : 'Offline'}</StatusBadge>}
    >
      <div className="topic-row">
        <span className="topic-chip">
          <span className="topic-chip__dir">ROS → WEB</span>
          {APP_CONFIG.ros.topics.testFromRos.name}
        </span>
        <span className="topic-chip">
          <span className="topic-chip__dir">WEB → ROS</span>
          {APP_CONFIG.ros.topics.testToRos.name}
        </span>
      </div>

      <div className="message-readout">
        <div className="message-readout__header">
          <span>Latest ROS heartbeat</span>
          {latestTestMessage ? (
            <span className="message-readout__time">
              {formatMessageTime(latestTestMessage.receivedAt)}
            </span>
          ) : (
            <StatusBadge tone="neutral">Waiting</StatusBadge>
          )}
        </div>
        <pre className={`message-readout__body ${latestTestMessage ? '' : 'is-empty'}`.trim()}>
          {latestTestMessage?.data ?? 'No message received yet. Start the ROS 2 test node to stream real data.'}
        </pre>
      </div>

      <div className="message-readout message-readout--ack">
        <div className="message-readout__header">
          <span>Latest ROS acknowledgement</span>
          {latestAck ? (
            <span className="message-readout__time">{formatMessageTime(latestAck.receivedAt)}</span>
          ) : (
            <StatusBadge tone="neutral">No ACK</StatusBadge>
          )}
        </div>
        <pre className={`message-readout__body ${latestAck ? '' : 'is-empty'}`.trim()}>
          {latestAck?.data ??
            'Publish a message below. The ROS node echoes a real acknowledgement back on /agv_web/ack.'}
        </pre>
      </div>

      <form className="publish-form" onSubmit={handleSubmit}>
        <label className="publish-form__label" htmlFor="ros-test-payload">
          Publish to {APP_CONFIG.ros.topics.testToRos.name}
        </label>
        <div className="publish-form__controls">
          <input
            id="ros-test-payload"
            type="text"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setError(null);
            }}
            placeholder="Type a test message"
            maxLength={220}
            autoComplete="off"
            disabled={!isConnected}
          />
          <button
            type="submit"
            className="button button--primary"
            disabled={!isConnected || message.trim().length === 0}
          >
            <Icon name="send" size={16} />
            Publish
          </button>
        </div>
        {!isConnected && (
          <p className="form-hint form-hint--warning">
            Connect to rosbridge before publishing. The 3D scene remains available offline.
          </p>
        )}
        {error && <p className="form-hint form-hint--error">{error}</p>}
      </form>

      <div className="test-stats">
        <FieldRow label="Heartbeats received" value={receivedCount.toString()} mono />
        <FieldRow label="Messages published" value={sentCount.toString()} mono />
        <FieldRow
          label="Last test result"
          value={latestAck ? 'ACK received' : 'Not yet verified'}
          mono
        />
      </div>
    </Panel>
  );
}

import { useEffect, useRef } from 'react';
import { useRos } from '../../ros/RosProvider';
import { formatLogTime } from '../../ros/logging';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import type { RosLogLevel } from '../../types/ros';

const LEVEL_CLASS: Record<RosLogLevel, string> = {
  info: 'is-info',
  success: 'is-success',
  warning: 'is-warning',
  error: 'is-error',
  system: 'is-system',
};

export function SystemLogPanel() {
  const { logs, clearLogs, state } = useRos();
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [logs.length]);

  return (
    <Panel
      eyebrow="Diagnostics"
      title="ROS communication log"
      className="log-panel"
      actions={
        <div className="log-panel__actions">
          <span className="log-panel__count">{logs.length} events</span>
          <button type="button" className="text-button" onClick={clearLogs} disabled={logs.length === 0}>
            Clear
          </button>
        </div>
      }
    >
      <div className="log-list" ref={listRef} role="log" aria-live="polite" aria-label="ROS communication events">
        {logs.length === 0 ? (
          <div className="log-empty">
            <Icon name="terminal" size={18} />
            <span>No events yet. Connection messages and ROS traffic appear here.</span>
          </div>
        ) : (
          logs.map((entry) => (
            <div className={`log-entry ${LEVEL_CLASS[entry.level]}`} key={entry.id}>
              <time className="log-entry__time">{formatLogTime(entry.timestamp)}</time>
              <span className="log-entry__source">{entry.source}</span>
              <span className="log-entry__dot" aria-hidden="true" />
              <span className="log-entry__message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
      <div className="log-panel__footer">
        <span className={`log-panel__status log-panel__status--${state.status}`}>
          <span aria-hidden="true" />
          {state.status === 'connected'
            ? `Bridge online · ${state.endpoint}`
            : state.status === 'connecting'
              ? 'Opening WebSocket transport'
              : state.status === 'error'
                ? 'Bridge unavailable · automatic retry active'
                : 'Bridge offline'}
        </span>
        <span className="log-panel__hint">ROS 2 Humble · std_msgs/String</span>
      </div>
    </Panel>
  );
}

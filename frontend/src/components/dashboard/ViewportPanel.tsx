import { useViewport } from '../../viewport/ViewportProvider';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';

const MODE_LABELS = {
  overview: 'Overview',
  follow: 'Follow AGV',
  close: 'AGV close view',
} as const;

export function ViewportPanel() {
  const {
    mode,
    followEnabled,
    collisionDebugVisible,
    setCollisionDebugVisible,
    selectOverview,
    selectStorage,
    selectCloseView,
    focusAgv,
    setFollowEnabled,
    resetView,
  } = useViewport();

  return (
    <Panel
      eyebrow="Camera"
      title="Camera & overlays"
      actions={<StatusBadge tone={followEnabled ? 'success' : 'neutral'}>{MODE_LABELS[mode]}</StatusBadge>}
    >
      <div className="camera-controls">
        <div className="camera-mode-grid">
          <button
            type="button"
            className={mode === 'overview' ? 'camera-mode is-active' : 'camera-mode'}
            onClick={selectOverview}
          >
            Overview
          </button>
          <button type="button" className="camera-mode" onClick={selectStorage}>
            Storage racks
          </button>
          <button
            type="button"
            className={mode === 'close' ? 'camera-mode is-active' : 'camera-mode'}
            onClick={selectCloseView}
          >
            AGV close view
          </button>
        </div>

        <label className="camera-toggle">
          <input
            type="checkbox"
            checked={followEnabled}
            onChange={(event) => setFollowEnabled(event.target.checked)}
          />
          <span className="camera-toggle__switch" aria-hidden="true">
            <span />
          </span>
          <span className="camera-toggle__text">
            <strong>Follow AGV</strong>
            <em>Keep the robot in view</em>
          </span>
        </label>

        <div className="camera-actions">
          <button type="button" className="camera-action camera-action--primary" onClick={focusAgv}>
            <Icon name="robot" size={16} />
            Focus AGV
          </button>
          <button type="button" className="camera-action" onClick={resetView}>
            <Icon name="reset" size={16} />
            Reset view
          </button>
        </div>

        <div className="sim-divider" />

        <label className="camera-toggle">
          <input
            type="checkbox"
            checked={collisionDebugVisible}
            onChange={(event) => setCollisionDebugVisible(event.target.checked)}
          />
          <span className="camera-toggle__switch" aria-hidden="true">
            <span />
          </span>
          <span className="camera-toggle__text">
            <strong>Show Collision Geometry</strong>
            <em>Show the obstacle and robot footprints</em>
          </span>
        </label>

        {collisionDebugVisible && (
          <div className="collision-legend" aria-label="Collision geometry legend">
            <span><i style={{ background: '#5b8def' }} />Rack support</span>
            <span><i style={{ background: '#b8c2cc' }} />Base plate</span>
            <span><i style={{ background: '#ff9f43' }} />Shelf/load</span>
            <span><i style={{ background: '#a06cd5' }} />End brace</span>
            <span><i style={{ background: '#ffd166' }} />Guard</span>
            <span><i style={{ background: '#4ade80' }} />AGV footprint</span>
            <span><i style={{ background: '#ff4d4f' }} />Blocking object</span>
          </div>
        )}

        <p className="camera-note">
          The collision overlay shows the robot footprint and obstacles used by the simulator.
        </p>
      </div>
    </Panel>
  );
}

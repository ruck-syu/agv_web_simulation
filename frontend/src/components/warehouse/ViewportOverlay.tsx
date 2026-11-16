import { ObstacleStatus } from './ObstacleStatus';
import { useSimulation } from '../../simulation/SimulationProvider';
import { useViewport } from '../../viewport/ViewportProvider';
import { Icon } from '../ui/Icon';

interface ViewportOverlayProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function ViewportOverlay({
  isFullscreen,
  onToggleFullscreen,
}: ViewportOverlayProps) {
  const { snapshot } = useSimulation();
  const {
    mode,
    followEnabled,
    collisionDebugVisible,
    selectOverview,
    selectStorage,
    selectFollow,
    selectCloseView,
    setFollowEnabled,
    focusAgv,
    resetView,
  } = useViewport();
  const live =
    snapshot.connectionStatus === 'connected' &&
    snapshot.telemetry !== null &&
    !snapshot.stale;
  const connected = snapshot.connectionStatus === 'connected';

  return (
    <div className="viewport-overlay">
      <div className="viewport-overlay__top">
        <div className="viewport-heading">
          <h2>Warehouse floor</h2>
          <span className="viewport-dimensions">64 × 40 m</span>
        </div>

        <div className="viewport-controls">
          <div className="segmented" role="group" aria-label="Camera viewpoint">
            <button
              type="button"
              className={mode === 'overview' ? 'is-active' : ''}
              onClick={selectOverview}
            >
              Overview
            </button>
            <button type="button" onClick={selectStorage}>
              Storage
            </button>
            <button
              type="button"
              className={mode === 'follow' ? 'is-active' : ''}
              aria-pressed={followEnabled && mode === 'follow'}
              onClick={() => {
                if (mode === 'follow') {
                  setFollowEnabled(false);
                } else {
                  selectFollow();
                }
              }}
            >
              Follow AGV
            </button>
            <button
              type="button"
              className={mode === 'close' ? 'is-active' : ''}
              onClick={selectCloseView}
            >
              AGV close
            </button>
          </div>
          <button
            type="button"
            className="viewport-icon-button"
            onClick={focusAgv}
            title="Centre the camera on the robot"
          >
            <Icon name="robot" size={16} />
            <span>Focus AGV</span>
          </button>
          <button
            type="button"
            className="viewport-icon-button"
            onClick={resetView}
            title="Reset camera to the warehouse overview"
          >
            <Icon name="reset" size={16} />
            <span>Reset view</span>
          </button>
          <button
            type="button"
            className="viewport-icon-button viewport-icon-button--square"
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit full screen' : 'Full-screen viewport'}
            aria-label={isFullscreen ? 'Exit full screen' : 'Full-screen viewport'}
          >
            <Icon name={isFullscreen ? 'minimize' : 'maximize'} size={17} />
          </button>
        </div>
      </div>

      <ObstacleStatus />
      <div className="viewport-overlay__bottom">
        <div className="viewport-control-hint">
          <span><strong>Drag</strong> orbit</span>
          <span className="viewport-control-hint__divider" />
          <span><strong>Scroll</strong> zoom</span>
          <span className="viewport-control-hint__divider" />
          <span><strong>Right-drag</strong> pan in overview</span>
          {collisionDebugVisible && (
            <>
              <span className="viewport-control-hint__divider" />
              <span><strong>Collision geometry</strong> visible</span>
            </>
          )}
        </div>
        <div className={`viewport-static-note ${live ? 'is-live' : ''}`.trim()}>
          <span className="viewport-static-note__dot" aria-hidden="true" />
          {live
            ? 'Live position tracking'
            : connected
              ? 'Connected · waiting for robot telemetry'
              : 'Simulation offline · check the connection in Diagnostics'}
        </div>
      </div>
    </div>
  );
}

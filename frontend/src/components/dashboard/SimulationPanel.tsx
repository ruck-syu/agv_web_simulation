import { APP_CONFIG } from '../../config/appConfig';
import { WAREHOUSE_LAYOUT } from '../../config/warehouseConfig';
import { useSimulation } from '../../simulation/SimulationProvider';
import type { CollisionState } from '../../simulation/types';
import { FieldRow } from '../ui/FieldRow';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';

const MOTION_LABELS: Record<string, string> = {
  moving: 'Forward',
  reversing: 'Reverse',
  turning: 'Turning',
  'moving+turning': 'Arc motion',
  blocked: 'Blocked',
  timeout: 'Command timeout',
  stopped: 'Stopped',
  unknown: 'Awaiting data',
};

function formatValue(value: number | null | undefined, digits = 3): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function formatAge(receivedAt: number, now: number): string {
  if (receivedAt <= 0) return 'no data';
  const age = Math.max(0, now - receivedAt);
  return age < 1000 ? `${Math.round(age)} ms ago` : `${(age / 1000).toFixed(1)} s ago`;
}

function collisionPresentation(state: CollisionState): {
  tone: 'success' | 'danger' | 'warning' | 'neutral';
  label: string;
} {
  if (state === 'clear') return { tone: 'success', label: 'No collision' };
  if (state === 'blocked') return { tone: 'danger', label: 'Movement blocked' };
  if (state === 'contact') return { tone: 'danger', label: 'Obstacle contact' };
  return { tone: 'neutral', label: 'Awaiting status' };
}

export function SimulationPanel() {
  const { snapshot } = useSimulation();
  const { telemetry, collision } = snapshot;
  const now = performance.now();
  const poseFresh =
    telemetry !== null && now - telemetry.poseReceivedAt <= APP_CONFIG.simulation.staleAfterMs;
  const collisionFresh =
    snapshot.connectionStatus === 'connected' &&
    collision.receivedAt > 0 &&
    now - collision.receivedAt < 2500;
  const live = snapshot.connectionStatus === 'connected' && poseFresh;
  const state = collisionFresh ? collision.state : 'unknown';
  const presentation = collisionPresentation(state);
  const motionLabel = collisionFresh
    ? (MOTION_LABELS[collision.motionState] ?? collision.motionState)
    : 'Awaiting data';
  const objectId = collision.blockedObjectId ?? collision.lastObjectId;
  const objectType = collision.blockedObjectType ?? collision.lastObjectType;
  const lastAge = collision.lastBlockedAgeSec;
  const wheelRadius = WAREHOUSE_LAYOUT.agv.wheelRadius;

  return (
    <Panel
      eyebrow="Live robot"
      title="Robot telemetry"
      className="simulation-panel"
      actions={
        <StatusBadge tone={live ? 'success' : 'warning'} dot>
          {live ? 'Live telemetry' : 'Awaiting /agv_web/ground_truth'}
        </StatusBadge>
      }
    >
      <div className="telemetry-heading">
        <span>Current robot state</span>
        <span className="telemetry-heading__source">
          /agv_web/ground_truth {formatAge(telemetry?.poseReceivedAt ?? 0, now)}
        </span>
      </div>

      <div className="telemetry-grid">
        <div className="telemetry-cell">
          <span>Position X</span>
          <strong>{formatValue(telemetry?.pose.x)}</strong>
          <em>m</em>
        </div>
        <div className="telemetry-cell">
          <span>Position Y</span>
          <strong>{formatValue(telemetry?.pose.y)}</strong>
          <em>m</em>
        </div>
        <div className="telemetry-cell">
          <span>Heading</span>
          <strong>
            {telemetry ? `${((telemetry.pose.yaw * 180) / Math.PI).toFixed(1)}°` : '—'}
          </strong>
          <em>{telemetry ? `${telemetry.pose.yaw.toFixed(3)} rad` : 'rad'}</em>
        </div>
        <div className="telemetry-cell">
          <span>Motion state</span>
          <strong className="telemetry-cell__state">{motionLabel}</strong>
          <em>{collisionFresh && collision.commandActive ? 'command active' : 'command idle'}</em>
        </div>
        <div className="telemetry-cell">
          <span>Linear velocity</span>
          <strong>{formatValue(telemetry?.linearVelocity)}</strong>
          <em>m/s</em>
        </div>
        <div className="telemetry-cell">
          <span>Angular velocity</span>
          <strong>{formatValue(telemetry?.angularVelocity)}</strong>
          <em>rad/s</em>
        </div>
        <div className="telemetry-cell">
          <span>Left wheel</span>
          <strong>{formatValue(telemetry?.leftWheelVelocity)}</strong>
          <em title={`${formatValue((telemetry?.leftWheelVelocity ?? 0) * wheelRadius)} m/s`}>
            rad/s
          </em>
        </div>
        <div className="telemetry-cell">
          <span>Right wheel</span>
          <strong>{formatValue(telemetry?.rightWheelVelocity)}</strong>
          <em title={`${formatValue((telemetry?.rightWheelVelocity ?? 0) * wheelRadius)} m/s`}>
            rad/s
          </em>
        </div>
      </div>

      <div className={`collision-banner collision-banner--${presentation.tone}`}>
        <div className="collision-banner__icon">
          <Icon name={state === 'clear' ? 'check' : 'alert'} size={16} />
        </div>
        <div className="collision-banner__copy">
          <strong>{presentation.label}</strong>
          <span>
            {state === 'unknown'
              ? 'Waiting for /agv_web/collision_status from the Python backend.'
              : objectId
                ? `Object: ${objectId}${objectType ? ` (${objectType})` : ''}${
                    !collision.blocked && lastAge !== null
                      ? ` · last contact ${lastAge.toFixed(1)} s ago`
                      : ''
                  }`
                : 'AGV footprint is clear of warehouse geometry.'}
          </span>
        </div>
        <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
      </div>

      <div className="sim-diagnostics">
        <FieldRow
          label="Source of truth"
          value="Python differential-drive node"
          title="The browser only visualises backend ground truth"
        />
        <FieldRow label="Wheel feedback" value="/joint_states" mono />
        <FieldRow
          label="Command link"
          value={
            snapshot.commandTxCount > 0
              ? `${snapshot.commandTxCount} Twist messages published`
              : 'No commands published yet'
          }
        />
        <FieldRow
          label="Command timeout"
          value={`${(APP_CONFIG.simulation.commandTimeoutMs / 1000).toFixed(1)} s (backend)`}
          mono
        />
        <FieldRow
          label="Last command"
          value={
            snapshot.lastCommand
              ? `v=${snapshot.lastCommand.linear.toFixed(2)} m/s · ω=${snapshot.lastCommand.angular.toFixed(2)} rad/s`
              : '—'
          }
        />
      </div>
    </Panel>
  );
}

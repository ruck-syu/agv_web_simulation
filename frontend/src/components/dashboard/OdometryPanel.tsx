import { APP_CONFIG } from '../../config/appConfig';
import { useSimulation } from '../../simulation/SimulationProvider';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';

export function OdometryPanel() {
  const { snapshot } = useSimulation();
  const { wheelOdometry: estimate, odometryStatus: status } = snapshot;
  const now = performance.now();
  const connected = snapshot.connectionStatus === 'connected';
  const live = connected && estimate !== null &&
    now - estimate.poseReceivedAt < APP_CONFIG.simulation.staleAfterMs;
  const statusLive = connected && status !== null &&
    now - status.receivedAt < APP_CONFIG.simulation.staleAfterMs;
  const fields = [
    ['Estimated X / Y', live ? `${estimate.pose.x.toFixed(3)} / ${estimate.pose.y.toFixed(3)} m` : '—'],
    ['Estimated heading', live ? `${(estimate.pose.yaw * 180 / Math.PI).toFixed(2)}°` : '—'],
    ['Position error vs truth', statusLive ? `${status.positionError.toFixed(4)} m` : '—'],
    ['Heading error vs truth', statusLive ? `${(status.headingError * 180 / Math.PI).toFixed(3)}°` : '—'],
    ['Encoder distance', statusLive ? `${status.distance.toFixed(2)} m` : '—'],
    ['Left / right scale', statusLive ? `${status.leftScale.toFixed(4)} / ${status.rightScale.toFixed(4)}` : '—'],
    ['Position uncertainty √(σx²+σy²)', statusLive ? `${status.positionStd.toFixed(3)} m` : '—'],
    ['Heading uncertainty σ', statusLive ? `${(status.headingStd * 180 / Math.PI).toFixed(2)}°` : '—'],
  ];
  return <Panel eyebrow="Wheel estimate" title="Wheel odometry"
    actions={<StatusBadge tone={live ? 'success' : 'warning'}>{live ? 'Live estimate' : 'Awaiting estimate'}</StatusBadge>}>
    <dl className="odometry-fields">
      {fields.map(([label, value]) => <div className="field-row" key={label}>
        <dt className="field-row__label">{label}</dt>
        <dd className="field-row__value">{value}</dd>
      </div>)}
    </dl>
    <p className="panel__footnote">Estimated from wheel travel. Drift accumulates with encoder error;
      no absolute localization correction is applied yet. The warehouse model and LiDAR display use simulator ground truth.
      Error measurements compare both poses at the same backend step.</p>
  </Panel>;
}

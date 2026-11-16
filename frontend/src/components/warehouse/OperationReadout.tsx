import { useSimulation } from '../../simulation/SimulationProvider';

export function OperationReadout() {
  const { snapshot } = useSimulation();
  const live = snapshot.connectionStatus === 'connected' && !snapshot.stale;
  const telemetry = live ? snapshot.telemetry : null;
  const collision = snapshot.collision;
  const collisionLive = live && collision.receivedAt > 0 && collision.state !== 'unknown' &&
    performance.now() - collision.receivedAt < 2500;
  const motion = telemetry ? Math.abs(telemetry.linearVelocity) > 0.005
    ? telemetry.linearVelocity < 0 ? 'Reversing' : 'Moving'
    : Math.abs(telemetry.angularVelocity) > 0.005 ? 'Turning' : 'Stopped' : 'Offline';
  const blocked = collisionLive && (collision.blocked || collision.collision);
  return <dl className="operation-readout" aria-label="Live robot summary">
    <div><dt>Motion</dt><dd>{blocked ? 'Blocked' : motion}</dd></div>
    <div><dt>Speed</dt><dd>{telemetry ? telemetry.linearVelocity.toFixed(2) : '—'}<small> m/s</small></dd></div>
    <div><dt>Position X / Y</dt><dd>{telemetry ? `${telemetry.pose.x.toFixed(2)} / ${telemetry.pose.y.toFixed(2)}` : '—'}<small> m</small></dd></div>
    <div><dt>Collision protection</dt><dd className={blocked ? 'is-danger' : ''}>{collisionLive ? blocked ? 'Movement blocked' : 'Path clear' : 'Waiting for data'}</dd></div>
  </dl>;
}

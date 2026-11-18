import { useFleet } from '../../fleet/FleetProvider';
import { useId, useState, type FormEvent } from 'react';
import { useNavigation } from '../../navigation/NavigationProvider';
import { useSimulation } from '../../simulation/SimulationProvider';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';

export function NavigationPanel() {
  const { live: fleetLive, fleet } = useFleet();
  const { status, sendGoal, cancel } = useNavigation();
  const { snapshot } = useSimulation();
  const id = useId();
  const [x, setX] = useState('0'), [y, setY] = useState('0'), [yaw, setYaw] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const live = snapshot.connectionStatus === 'connected' && status !== null && performance.now() - status.receivedAt < 1500;
  const active = live && status.busy;
  const ready = fleetLive && !fleet?.safety_stop && live && status.ready && !active && !snapshot.stale;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = sendGoal(Number(x), Number(y), Number(yaw) * Math.PI / 180);
    setError(typeof result === 'string' ? result : null);
  };
  return <Panel eyebrow="Goal control" title="Autonomous navigation"
    actions={<StatusBadge tone={active ? 'info' : ready ? 'success' : 'warning'}>{live ? status.state : 'Awaiting fleet'}</StatusBadge>}>
    <form aria-label="World navigation goal" onSubmit={submit} className="navigation-form">
      <div className="navigation-inputs">
        <label htmlFor={`${id}-x`}>Goal X (world m)<input id={`${id}-x`} type="number" required min="-100" max="100" step="0.1" value={x} onChange={(e) => setX(e.target.value)} /></label>
        <label htmlFor={`${id}-y`}>Goal Y (world m)<input id={`${id}-y`} type="number" required min="-100" max="100" step="0.1" value={y} onChange={(e) => setY(e.target.value)} /></label>
        <label htmlFor={`${id}-yaw`}>Heading (°)<input id={`${id}-yaw`} type="number" required min="-360" max="360" step="1" value={yaw} onChange={(e) => setYaw(e.target.value)} /></label>
      </div>
      <div className="navigation-actions">
        <button type="submit" disabled={!ready}>Navigate to goal</button>
        <button type="button" onClick={cancel} disabled={snapshot.connectionStatus !== 'connected'}>Cancel / stop</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
    <p>{live ? status.detail : 'Navigation unavailable. Check Diagnostics & connection.'}</p>
    {live && status.distanceRemaining !== null && <p>Distance remaining: {status.distanceRemaining.toFixed(2)} m</p>}
    <p className="panel__footnote">Enter a destination in world coordinates. Manual driving takes priority. Keep this tab visible during navigation.</p>
  </Panel>;
}

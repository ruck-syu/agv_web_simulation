import { useLidar } from '../../simulation/LidarProvider';
import { useSimulation } from '../../simulation/SimulationProvider';
import { useMapping } from '../../mapping/MappingProvider';
import { useNavigation } from '../../navigation/NavigationProvider';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';

export function SystemHealthPanel() {
  const { snapshot } = useSimulation();
  const { live: lidarLive } = useLidar();
  const { map, transform } = useMapping();
  const { status } = useNavigation();
  const now = performance.now();
  const connected = snapshot.connectionStatus === 'connected';
  const fresh = (time: number | undefined, expiry = 1500) => connected && time !== undefined && now - time < expiry;
  const checks: [string, boolean][] = [
    ['ROS bridge', connected],
    ['Physical robot telemetry', connected && !snapshot.stale],
    ['Wheel odometry', fresh(snapshot.wheelOdometry?.poseReceivedAt)],
    ['Roof LiDAR', lidarLive],
    ['SLAM map', fresh(map?.receivedAt, 30000)],
    ['Map localization TF', fresh(transform?.receivedAt)],
    ['Collision diagnostics', fresh(snapshot.collision.receivedAt)],
    ['Nav2 lifecycle', fresh(status?.receivedAt) && status?.serverReady === true],
    ['Navigation sensor inputs', fresh(status?.receivedAt) && status?.sensorsReady === true],
    ['Operator heartbeat', fresh(status?.receivedAt) && status?.operatorReady === true],
  ];
  const count = checks.filter(([, healthy]) => healthy).length;
  return <Panel eyebrow="Diagnostics" title="System health"
    actions={<StatusBadge tone={count === checks.length ? 'success' : 'warning'}>{count}/{checks.length} ready</StatusBadge>}>
    <dl className="odometry-fields">{checks.map(([label, healthy]) => <div className="field-row" key={label}>
      <dt className="field-row__label">{label}</dt>
      <dd className="field-row__value"><StatusBadge tone={healthy ? 'success' : 'warning'}>{healthy ? 'Ready' : 'Awaiting data'}</StatusBadge></dd>
    </div>)}</dl>
    <p className="panel__footnote">Readiness reflects the latest received data.
      Manual drive remains available while mapping. Autonomous goals require active Nav2 nodes and fresh sensor streams.</p>
  </Panel>;
}

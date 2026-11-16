import { Html, Line } from '@react-three/drei';
import { useRackRoute, rackStops } from '../navigation/RackRouteProvider';
import { useNavigation } from '../navigation/NavigationProvider';
import { useMapping } from '../mapping/MappingProvider';
import { transformPose } from '../mapping/types';
import { useSimulation } from '../simulation/SimulationProvider';

export function RouteLayer() {
  const { preview, source, destination } = useRackRoute();
  const { path, status } = useNavigation();
  const { transform } = useMapping();
  const { snapshot } = useSimulation();
  let livePoints: [number, number, number][] = [];
  const truth = snapshot.telemetry, odom = snapshot.wheelOdometry;
  if (transform && truth && odom && !snapshot.stale && snapshot.connectionStatus === 'connected' && status?.busy && performance.now() - status.receivedAt < 1500 && performance.now() - transform.receivedAt < 1500) {
    const localized = transformPose(transform, odom.pose);
    const rotation = truth.pose.yaw - localized.yaw;
    livePoints = path.map(p => {
      const dx = p.x - localized.x, dy = p.y - localized.y;
      return [truth.pose.x + Math.cos(rotation)*dx - Math.sin(rotation)*dy, .18,
        -(truth.pose.y + Math.sin(rotation)*dx + Math.cos(rotation)*dy)];
    });
  }
  return <group renderOrder={30}>
    {preview.length > 1 && <Line points={preview.map(p => [p.x, .12, -p.y])} color="#21c9f3" lineWidth={4} depthTest={false} />}
    {livePoints.length > 1 && <Line points={livePoints} color="#4ade80" lineWidth={3} depthTest={false} />}
    {rackStops.filter(r => r.id === source || r.id === destination).map(r => <group key={r.id} position={[r.x, .15, -r.y]}>
      <mesh rotation={[-Math.PI/2, 0, 0]}><ringGeometry args={[.45, .65, 32]} /><meshBasicMaterial color={r.id === source ? '#4ade80' : '#ffb454'} depthTest={false} /></mesh>
      <Html position={[0, 1.5, 0]} center style={{ pointerEvents: 'none', whiteSpace: 'nowrap', color: r.id === source ? '#4ade80' : '#ffb454', background: '#13232fee', padding: '3px 6px', fontSize: '12px' }}>{r.id === source ? 'SOURCE' : 'DESTINATION'} {r.id}</Html>
    </group>)}
  </group>;
}

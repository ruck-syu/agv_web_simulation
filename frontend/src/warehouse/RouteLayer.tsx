import { Html, Line } from '@react-three/drei';
import { useRackRoute, rackStops } from '../navigation/RackRouteProvider';
import { useNavigation } from '../navigation/NavigationProvider';
import { useRobotId, ROBOT_COLORS } from '../fleet/RobotContext';
import { useSimulation } from '../simulation/SimulationProvider';

export function RouteLayer() {
  const { preview, source, destination } = useRackRoute();
  const { path, status } = useNavigation();
  const { snapshot } = useSimulation();
  const robotId = useRobotId();
  const color = ROBOT_COLORS[robotId];
  const livePoints: [number, number, number][] = !snapshot.stale && status?.busy && performance.now() - status.receivedAt < 1500
    ? path.map(p => [p.x, .18, -p.y]) : [];
  return <group renderOrder={30}>
    {preview.length > 1 && <Line points={preview.map(p => [p.x, .12, -p.y])} color={color} lineWidth={4} depthTest={false} />}
    {livePoints.length > 1 && <Line points={livePoints} color={color} dashed dashSize={.3} gapSize={.15} lineWidth={3} depthTest={false} />}
    {rackStops.filter(r => r.id === source || r.id === destination).map(r => <group key={r.id} position={[r.x, .15, -r.y]}>
      <mesh rotation={[-Math.PI/2, 0, 0]}><ringGeometry args={[.45, .65, 32]} /><meshBasicMaterial color={r.id === source ? '#4ade80' : '#ffb454'} depthTest={false} /></mesh>
      <Html position={[0, 1.5, 0]} center style={{ pointerEvents: 'none', whiteSpace: 'nowrap', color: r.id === source ? '#4ade80' : '#ffb454', background: '#13232fee', padding: '3px 6px', fontSize: '12px' }}>{robotId} {r.id === source ? 'SOURCE' : 'DESTINATION'} {r.id}</Html>
    </group>)}
  </group>;
}

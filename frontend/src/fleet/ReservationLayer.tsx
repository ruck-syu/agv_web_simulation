import { useMemo } from 'react';
import { useFleet } from './FleetProvider';
import { ROBOTS, ROBOT_COLORS } from './RobotContext';
export function ReservationLayer() {
  const { fleet, live } = useFleet();
  const tiles = useMemo(() => ROBOTS.map(id => {
    const points: number[] = [];
    for (const [i, j] of fleet?.reserved_zones[id] ?? []) {
      const x = i * .5, z = -j * .5;
      points.push(x, .035, z, x+.5, .035, z, x+.5, .035, z-.5, x, .035, z, x+.5, .035, z-.5, x, .035, z-.5);
    }
    return { id, points: new Float32Array(points) };
  }), [fleet]);
  if (!live) return null;
  return <group>{tiles.map(({ id, points }) => <mesh key={id}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[points, 3]} /></bufferGeometry>
    <meshBasicMaterial color={ROBOT_COLORS[id]} transparent opacity={.2} depthWrite={false} />
  </mesh>)}</group>;
}

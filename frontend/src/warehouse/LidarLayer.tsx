import { useRobotId, ROBOT_COLORS } from '../fleet/RobotContext';
import { useMemo } from 'react';
import { useLidar } from '../simulation/LidarProvider';

export function LidarLayer() {
  const robotId = useRobotId();
  const { scan, pose, live, visible, raysVisible } = useLidar();
  const { positions, colors, rays } = useMemo(() => {
    const points: number[] = [], colors: number[] = [], rays: number[] = [];
    if (scan && pose) scan.ranges.forEach((range, index) => {
      if (range === null) return;
      const angle = pose.yaw + scan.angleMin + index * scan.angleIncrement;
      const x = pose.x + range * Math.cos(angle), z = -(pose.y + range * Math.sin(angle));
      points.push(x, 1.02, z);
      colors.push(...(range < 2 ? [1, .25, .2] : (robotId === 'agv1' ? [.2, .85, 1] : [1, .7, .33])));
      // Decimate only the ray fan; preserve every measured endpoint.
      if (index % 8 === 0) rays.push(pose.x, 1.02, -pose.y, x, 1.02, z);
    });
    return { positions: new Float32Array(points), colors: new Float32Array(colors), rays: new Float32Array(rays) };
  }, [scan, pose, robotId]);
  if (!visible || !live || !pose || positions.length === 0) return null;
  return <group>
    <points frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /><bufferAttribute attach="attributes-color" args={[colors, 3]} /></bufferGeometry>
      <pointsMaterial vertexColors size={.13} sizeAttenuation depthTest={false} />
    </points>
    {raysVisible && <lineSegments frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[rays, 3]} /></bufferGeometry>
      <lineBasicMaterial color={ROBOT_COLORS[robotId]} transparent opacity={.18} depthWrite={false} />
    </lineSegments>}
  </group>;
}

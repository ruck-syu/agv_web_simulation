import { useMemo } from 'react';
import { useLidar } from '../simulation/LidarProvider';

export function LidarLayer() {
  const { scan, pose, live, visible } = useLidar();
  const positions = useMemo(() => {
    if (!scan || !pose) return new Float32Array();
    const points: number[] = [];
    scan.ranges.forEach((range, index) => {
      if (range === null) return;
      const angle = pose.yaw + scan.angleMin + index * scan.angleIncrement;
      // ROS (x,y,z) maps to Three.js (x,z,-y).
      points.push(pose.x + range * Math.cos(angle), 1.02, -(pose.y + range * Math.sin(angle)));
    });
    return new Float32Array(points);
  }, [scan, pose]);
  if (!visible || !live || !pose || positions.length === 0) return null;
  return <points frustumCulled={false}>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[positions, 3]} />
    </bufferGeometry>
    <pointsMaterial color="#67e8f9" size={0.09} sizeAttenuation />
  </points>;
}

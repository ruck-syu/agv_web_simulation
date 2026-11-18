import { useLidar } from '../../simulation/LidarProvider';
import { nearestReturn } from '../../simulation/lidar';
import { useSimulation } from '../../simulation/SimulationProvider';
export function ObstacleStatus() {
  const { scan, live } = useLidar();
  const { snapshot } = useSimulation();
  const collision = snapshot.collision;
  const freshCollision = snapshot.connectionStatus === 'connected' && performance.now() - collision.receivedAt < 1500;
  const blocked = freshCollision && (collision.blocked || collision.collision);
  const nearest = live ? nearestReturn(scan) : null;
  const close = nearest !== null && nearest < 2;
  const warning = blocked || close;
  return <div className={`scene-status ${warning ? 'scene-status--danger' : ''}`} role="status" aria-live="polite">
    <strong>{blocked ? 'OBSTACLE · Motion blocked' : close ? 'OBSTACLE · Nearby return' : live ? 'LiDAR scanning' : 'Obstacle sensing unavailable'}</strong>
    <div>{blocked ? `${collision.blockedObjectType ?? 'Object'}: ${collision.blockedObjectId ?? 'unidentified'}` : nearest !== null ? `Nearest measured surface: ${nearest.toFixed(2)} m` : 'Waiting for fresh sensor data'}</div>
    <small>Cyan: agv1 · Orange: agv2 · Dashed: live plan · Red points: returns within 2 m</small>
  </div>;
}

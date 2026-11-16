import { useEffect, useRef } from 'react';
import { useNavigation } from '../../navigation/NavigationProvider';
import { useMapping } from '../../mapping/MappingProvider';
import { mapPixel, transformPose } from '../../mapping/types';
import { useSimulation } from '../../simulation/SimulationProvider';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';

export function MappingPanel() {
  const { status, path } = useNavigation();
  const { map, transform } = useMapping();
  const { snapshot } = useSimulation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const now = performance.now();
  const live = snapshot.connectionStatus === 'connected' && map !== null && now - map.receivedAt < 30000;
  const estimate = snapshot.wheelOdometry;
  const localized = live && estimate && transform && now - transform.receivedAt < 1500 && now - estimate.poseReceivedAt < 1500;
  const pose = localized ? transformPose(transform, estimate.pose) : null;
  const pixel = map && pose ? mapPixel(map, pose.x, pose.y) : null;
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!map || !context) return;
    const image = context.createImageData(map.width, map.height);
    for (let row = 0; row < map.height; row++) {
      for (let column = 0; column < map.width; column++) {
        const value = map.data[row * map.width + column];
        const shade = value < 0 ? 95 : Math.round(245 - value * 2.3);
        const offset = ((map.height - 1 - row) * map.width + column) * 4;
        image.data.set([shade, shade, shade, 255], offset);
      }
    }
    context.putImageData(image, 0, 0);
  }, [map]);
  return <Panel eyebrow="Live map" title="SLAM occupancy map"
    actions={<StatusBadge tone={live ? 'success' : 'warning'}>{live ? 'Map received' : 'Awaiting SLAM'}</StatusBadge>}>
    {map && live && <figure className="mapping-figure">
      <div className="mapping-grid" style={{ aspectRatio: `${map.width}/${map.height}` }}>
        <canvas ref={canvas} width={map.width} height={map.height} aria-label="SLAM occupancy grid: white free, dark occupied, gray unknown" role="img" />
        <svg viewBox={`0 0 ${map.width} ${map.height}`} aria-hidden="true">
          {map && live && status?.state === 'navigating' && <polyline
            points={path.map((point) => { const p = mapPixel(map, point.x, point.y); return `${p.x},${p.y}`; }).join(' ')}
            fill="none" stroke="#245b7d" strokeWidth={Math.max(1, 0.08 / map.resolution)} />}
          {pixel && <circle cx={pixel.x} cy={pixel.y} r={Math.max(3, 0.3 / map.resolution)} fill="#ef4444" stroke="white" />}
        </svg>
      </div>
      <figcaption>{map.width} × {map.height} cells · {map.resolution.toFixed(2)} m/cell.
        White: free, dark: occupied, gray: unknown. {pose ? `Robot at ${pose.x.toFixed(2)}, ${pose.y.toFixed(2)} m in map.` : 'Waiting for map localization transform.'}</figcaption>
    </figure>}
    <p className="panel__footnote">Drive through the aisles to build the map. Blue shows the current navigation path.</p>
  </Panel>;
}

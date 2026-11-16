import { useLidar } from '../../simulation/LidarProvider';
import { Panel } from '../ui/Panel';
import { FieldRow } from '../ui/FieldRow';
import { StatusBadge } from '../ui/StatusBadge';

export function LidarPanel() {
  const { scan, live, visible, setVisible, raysVisible, setRaysVisible } = useLidar();
  const hits = scan?.ranges.filter((value): value is number => value !== null) ?? [];
  const nearest = hits.length ? Math.min(...hits) : null;
  return (
    <Panel eyebrow="Obstacle sensing" title="LiDAR · 3D scan view"
      actions={<StatusBadge tone={live ? 'success' : 'warning'}>{live ? 'Live scan' : 'Awaiting scan'}</StatusBadge>}>
      <label className="lidar-toggle">
        <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
        Show LiDAR returns in warehouse
      </label>
      <label className="lidar-toggle"><input type="checkbox" checked={raysVisible} onChange={event => setRaysVisible(event.target.checked)} />Show scan rays in 3D</label>
      <FieldRow label="Returns / rays" value={live && scan ? `${hits.length} / ${scan.ranges.length}` : '—'} />
      <FieldRow label="Nearest return" value={live && nearest !== null ? `${nearest.toFixed(2)} m` : '—'} />
      <FieldRow label="Range" value={live && scan ? `${scan.rangeMin.toFixed(2)}–${scan.rangeMax.toFixed(0)} m` : '—'} />
      {live && scan && <svg viewBox="-105 -105 210 210" className="lidar-plot" role="img"
        aria-label={`Robot-relative LiDAR scan. ${hits.length} returns. Nearest return ${nearest?.toFixed(2) ?? 'none'} metres. Forward is up.`}>
        <circle r="95" fill="none" stroke="#64748b" />
        <path d="M0,-95V95 M-95,0H95" stroke="#64748b" opacity="0.4" />
        {scan.ranges.map((range, index) => {
          if (range === null) return null;
          const angle = scan.angleMin + index * scan.angleIncrement;
          return <circle key={index} cx={-Math.sin(angle) * range / scan.rangeMax * 95}
            cy={-Math.cos(angle) * range / scan.rangeMax * 95} r="1.4" fill={range < 2 ? "#ff665b" : "#21c9f3"} />;
        })}
        <path d="M0,-6 L4,4 L-4,4 Z" fill="#b23b36" />
      </svg>}
      <p className="panel__footnote">Planar sensor data displayed in 3D at the actual scan height. Forward is up; red marks returns within 2 m, including racks and walls.
        No return does not establish free space. Roof sensor height: 1.02 m.</p>
    </Panel>
  );
}

import { useId } from 'react';
import { rackStops, useRackRoute } from '../../navigation/RackRouteProvider';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';

export function RackRoutePanel() {
  const route = useRackRoute();
  const id = useId();
  return <Panel title="Rack-to-rack path planning" actions={<StatusBadge tone="info">{route.phase}</StatusBadge>}>
    <div className="rack-selectors">
      <label htmlFor={`${id}-source`}>Source rack<select id={`${id}-source`} disabled={route.running} value={route.source} onChange={e => route.select(e.target.value, route.destination)}>{rackStops.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
      <label htmlFor={`${id}-destination`}>Destination rack<select id={`${id}-destination`} disabled={route.running} value={route.destination} onChange={e => route.select(route.source, e.target.value)}>{rackStops.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
    </div>
    <div className="route-summary" role="status">{route.preview.length ? `${route.length.toFixed(1)} m · shortest preview around clearance-expanded obstacles` : route.source === route.destination ? 'Choose two different racks.' : 'No route available with AGV clearance.'}</div>
    <svg className="route-map" viewBox="-32 -20 64 40" role="img" aria-label={`Warehouse route preview from ${route.source} to ${route.destination}, ${route.length.toFixed(1)} metres. Green is source; orange is destination.`}>
      {route.boxes.map((b, i) => <rect key={i} x={b.minX} y={-b.maxY} width={b.maxX-b.minX} height={b.maxY-b.minY} fill="var(--line)" />)}
      <polyline points={route.preview.map(p => `${p.x},${-p.y}`).join(' ')} stroke="#21c9f3" strokeWidth=".35" fill="none" />
      {rackStops.filter(r => r.id === route.source || r.id === route.destination).map(r => <g key={r.id}><circle cx={r.x} cy={-r.y} r=".65" fill={r.id === route.source ? '#4ade80' : '#ffb454'} /><text x={r.x+1} y={-r.y+.5} fill="var(--text)" fontSize="1.8">{r.id}</text></g>)}
    </svg>
    <div className="button-row"><button className="button button--primary" disabled={!route.canStart} onClick={route.start}>Start rack route</button><button className="button" disabled={!route.running} onClick={route.stop}>Stop rack route</button></div>
    {!route.canStart && !route.running && route.preview.length > 0 && <p className="panel__footnote">Live travel requires Nav2 and fresh robot localization. The route preview remains available.</p>}
    {route.error && <p role="alert">{route.error}</p>}
    <p className="panel__footnote">Cyan: instant warehouse preview. Green: live Nav2 plan. The AGV visits the source, then the destination. Nav2 replans using its live map; preview distance excludes travel to the source. Preview uses known geometry, not a guarantee of free space.</p>
  </Panel>;
}

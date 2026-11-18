import { useId, useRef, useState } from 'react';
import { pairIssues, pairRejection, startBoth } from './types';
import { useRackRoute, useRackRoutes } from '../navigation/RackRouteProvider';
import { useFleet } from './FleetProvider';
import { ROBOTS, ROBOT_COLORS, RobotScope, useRobotId } from './RobotContext';
import { useSimulation } from '../simulation/SimulationProvider';
import { useNavigation } from '../navigation/NavigationProvider';
import { useRos } from '../ros/RosProvider';
import { useRosTopic } from '../hooks/useRosTopic';
import { Panel } from '../components/ui/Panel';
export function FleetPanel() {
  const { selected, select, fleet, live, stopAll, connected, stopErrors } = useFleet();
  const separation = live ? fleet?.separation_m : null;
  const routes = useRackRoutes(), issues = pairIssues(routes, separation);
  const [pairErrors, setPairErrors] = useState<string[]>([]);
  const { publish } = useRos();
  const issuesId = useId();
  const pairRequest = useRef<string | null>(null);
  useRosTopic('/fleet/start_pair_result', 'std_msgs/msg/String', message => {
    const rejection = pairRejection(message.data);
    if (!rejection || rejection.requestId !== pairRequest.current) return;
    for (const id of ROBOTS) routes[id]?.rejectPair(rejection.requestId);
    pairRequest.current = null;
    setPairErrors(rejection.issues);
  });
  const publishPair = (command: object) => publish('/fleet/start_pair', 'std_msgs/msg/String', {
    data: JSON.stringify(command),
  });
  const startPair = () => {
    const requestId = crypto.randomUUID();
    const errors = startBoth(routes, publishPair, requestId, separation);
    pairRequest.current = errors.length ? null : requestId;
    setPairErrors(errors);
  };
  const stopPair = () => {
    pairRequest.current = null;
    setPairErrors([]);
    stopAll();
  };
  return <Panel title="Fleet coordination">
    <fieldset className="fleet-selector"><legend>Control robot</legend>{ROBOTS.map(id => <label key={id} style={{ color: ROBOT_COLORS[id] }}>
      <input type="radio" name="control-robot" value={id} checked={selected === id} onChange={() => select(id)} /> {id}
    </label>)}</fieldset>
    <div className="button-row"><button type="button" className="button button--primary" disabled={issues.length > 0} aria-describedby={issuesId} onClick={startPair}>Start both</button>
    <button type="button" className="button" onClick={stopPair} disabled={!connected}>Stop all</button></div>
    <div id={issuesId} role="status">{issues.join(' ')}</div>
    {pairErrors.map(error => <p role="alert" key={error}>{error}</p>)}
    {stopErrors.map(error => <p role="alert" key={error}>{error}</p>)}
    <p role="status">{live ? `Separation: ${fleet?.separation_m?.toFixed(2) ?? 'unknown'} m` : 'Fleet telemetry unavailable / stale'}</p>
    {live && fleet?.safety_stop && <p role="alert">Separation / telemetry safety stop — autonomy canceled. Release controls, then manually retreat to increase separation (0.2 m/s, 0.3 rad/s maximum). Stops below 3.0 m; clears at 3.3 m. Resubmit goals after recovery.</p>}
    {ROBOTS.map(id => <RobotScope id={id} key={id}><FleetRobotRow /></RobotScope>)}
    <p className="panel__footnote">Solid: rack preview. Dashed: live world plan. Shaded 0.5 m tiles: reserved traffic zones. Colors and labels identify each robot.</p>
  </Panel>;
}
function FleetRobotRow() {
  const id = useRobotId(), { fleet, live } = useFleet();
  const { snapshot } = useSimulation(), route = useRackRoute();
  const r = fleet?.robots[id];
  return <div className="fleet-robot" style={{ borderInlineStart: `3px solid ${ROBOT_COLORS[id]}`, paddingInlineStart: '.6rem' }}>
    <strong>{id}</strong> · {live ? r?.state : 'Awaiting fleet'} · {route.source} → {route.destination} · {route.phase}
    <p>{live ? r?.detail : 'No fresh coordination data'}</p>
    <p>Waiting on: {live ? r?.waiting_on.join(', ') || 'none' : 'unknown'} · Reserved tiles: {live ? fleet?.reserved_zones[id].length : 'unknown'}</p>
    <p>Collision: {snapshot.stale ? 'unknown' : `${snapshot.collision.state} ${snapshot.collision.blockedObjectId ?? ''}`}</p>
  </div>;
}
export function FleetMapOverlay() {
  return <>{ROBOTS.map(id => <RobotScope id={id} key={id}><RobotMapOverlay /></RobotScope>)}</>;
}
function RobotMapOverlay() {
  const id = useRobotId(), { snapshot } = useSimulation(), { path, status } = useNavigation();
  const { preview } = useRackRoute(), { fleet, live } = useFleet();
  const pose = snapshot.telemetry?.pose ?? { x: id === 'agv1' ? -2.8 : 4.5, y: 1.6 };
  const color = ROBOT_COLORS[id];
  return <g aria-label={`${id} position, path and reservations`}>
    {live && fleet?.reserved_zones[id].map(([i, j]) => <rect key={`${i},${j}`} x={i*.5} y={-(j+1)*.5} width=".5" height=".5" fill={color} opacity=".2" />)}
    <polyline points={preview.map(p => `${p.x},${-p.y}`).join(' ')} stroke={color} strokeWidth=".2" fill="none" />
    {!snapshot.stale && status?.busy && <polyline points={path.map(p => `${p.x},${-p.y}`).join(' ')} stroke={color} strokeDasharray=".5 .3" strokeWidth=".35" fill="none" />}
    <circle cx={pose.x} cy={-pose.y} r=".65" fill={color} opacity={snapshot.stale ? .5 : 1} />
    <text x={pose.x+1} y={-pose.y-1} fill={color} fontSize="1.6">{id}{snapshot.stale ? ' (preview/stale)' : ''}</text>
  </g>;
}

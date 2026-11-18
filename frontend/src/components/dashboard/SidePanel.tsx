import { RackRoutePanel } from './RackRoutePanel';
import { NavigationPanel } from './NavigationPanel';
import { FleetPanel } from '../../fleet/FleetPanel';
import { useFleet } from '../../fleet/FleetProvider';
import { LidarPanel } from './LidarPanel';
import { SystemHealthPanel } from './SystemHealthPanel';
import { OdometryPanel } from './OdometryPanel';
import { RobotInfoPanel } from './RobotInfoPanel';
import { RosConnectionPanel } from './RosConnectionPanel';
import { SystemLogPanel } from './SystemLogPanel';
import { SimulationPanel } from './SimulationPanel';
import { ViewportPanel } from './ViewportPanel';
import { SimulationControls } from '../../simulation/SimulationControls';
import { Panel } from '../ui/Panel';

export function SidePanel() {
  const { selected, stopEpoch } = useFleet();
  return (
    <aside className="side-panel" aria-label="Robot controls and monitoring">
      <div className="console-heading">
        <div><span className="asset-mark" aria-hidden="true" /><strong>{selected}</strong></div>
        <span>Differential-drive carrier</span>
      </div>
      <FleetPanel />
      <RackRoutePanel />
      <Panel title="Drive AGV" className="manual-drive-panel">
        <SimulationControls key={`${selected}-${stopEpoch}`} />
      </Panel>
      <NavigationPanel key={selected} />
      <ViewportPanel />
      <SimulationPanel />
      <LidarPanel />
      <details className="diagnostics-disclosure">
        <summary>Diagnostics &amp; connection</summary>
        <div className="diagnostics-panels">
          <SystemHealthPanel />
          <OdometryPanel />
          <RobotInfoPanel />
          <RosConnectionPanel />
          <SystemLogPanel />
        </div>
      </details>
    </aside>
  );
}

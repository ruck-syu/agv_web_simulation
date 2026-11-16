import { NavigationPanel } from './NavigationPanel';
import { MappingPanel } from './MappingPanel';
import { LidarPanel } from './LidarPanel';
import { SystemHealthPanel } from './SystemHealthPanel';
import { OdometryPanel } from './OdometryPanel';
import { RobotInfoPanel } from './RobotInfoPanel';
import { RosConnectionPanel } from './RosConnectionPanel';
import { RosTestPanel } from './RosTestPanel';
import { SystemLogPanel } from './SystemLogPanel';
import { SimulationPanel } from './SimulationPanel';
import { ViewportPanel } from './ViewportPanel';
import { SimulationControls } from '../../simulation/SimulationControls';
import { Panel } from '../ui/Panel';

export function SidePanel() {
  return (
    <aside className="side-panel" aria-label="Robot controls and monitoring">
      <div className="console-heading">
        <div><span className="asset-mark" aria-hidden="true" /><strong>AGV-07</strong></div>
        <span>Differential-drive carrier</span>
      </div>
      <Panel title="Drive AGV" className="manual-drive-panel">
        <SimulationControls />
      </Panel>
      <NavigationPanel />
      <MappingPanel />
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
          <RosTestPanel />
          <SystemLogPanel />
        </div>
      </details>
    </aside>
  );
}

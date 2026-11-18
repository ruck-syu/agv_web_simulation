import { createRoot } from 'react-dom/client';
import App from './App';
import { RackRouteProvider } from './navigation/RackRouteProvider';
import { RosProvider } from './ros/RosProvider';
import { NavigationProvider } from './navigation/NavigationProvider';
import { FleetProvider } from './fleet/FleetProvider';
import { RobotScope } from './fleet/RobotContext';
import { LidarProvider } from './simulation/LidarProvider';
import { SimulationProvider } from './simulation/SimulationProvider';
import { ViewportProvider } from './viewport/ViewportProvider';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-600.css';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Application root element was not found.');
}

function RobotRuntime({ children }: { children: React.ReactNode }) {
  return <SimulationProvider><NavigationProvider><LidarProvider><RackRouteProvider>{children}</RackRouteProvider></LidarProvider></NavigationProvider></SimulationProvider>;
}
createRoot(root).render(
  <RosProvider><FleetProvider><ViewportProvider>
    <RobotScope id="agv1"><RobotRuntime>
      <RobotScope id="agv2"><RobotRuntime>
        <RobotScope id={null}><App /></RobotScope>
      </RobotRuntime></RobotScope>
    </RobotRuntime></RobotScope>
  </ViewportProvider></FleetProvider></RosProvider>,
);

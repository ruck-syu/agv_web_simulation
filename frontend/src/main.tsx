import { createRoot } from 'react-dom/client';
import App from './App';
import { RackRouteProvider } from './navigation/RackRouteProvider';
import { RosProvider } from './ros/RosProvider';
import { NavigationProvider } from './navigation/NavigationProvider';
import { MappingProvider } from './mapping/MappingProvider';
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

createRoot(root).render(
  <RosProvider>
    <SimulationProvider>
      <NavigationProvider>
        <MappingProvider>
          <LidarProvider>
            <ViewportProvider>
              <RackRouteProvider><App /></RackRouteProvider>
            </ViewportProvider>
          </LidarProvider>
        </MappingProvider>
      </NavigationProvider>
    </SimulationProvider>
  </RosProvider>,
);

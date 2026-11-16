import { lazy, Suspense, useRef } from 'react';
import { TopNav } from './components/layout/TopNav';
import { SidePanel } from './components/dashboard/SidePanel';
import { OperationReadout } from './components/warehouse/OperationReadout';
import { ViewportOverlay } from './components/warehouse/ViewportOverlay';
import { SceneErrorBoundary } from './components/SceneErrorBoundary';
import { useFullscreen } from './hooks/useFullscreen';
const WarehouseCanvas = lazy(() => import('./warehouse/WarehouseCanvas').then((module) => ({ default: module.WarehouseCanvas })));

export default function App() {
  const viewportRef = useRef<HTMLElement>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen(viewportRef);

  return (
    <div className="app-shell">
      <TopNav isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />

      <main className="workspace">
        <div className="main-column">
          <section className="viewport-panel" ref={viewportRef} aria-label="Interactive 3D warehouse">
            <SceneErrorBoundary>
              <Suspense fallback={<p className="scene-loading">Loading warehouse view…</p>}>
                <WarehouseCanvas />
              </Suspense>
            </SceneErrorBoundary>
            <ViewportOverlay
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
            />
          </section>
          <OperationReadout />
        </div>

        <SidePanel />
      </main>

      <footer className="app-footer">
        <span className="app-footer__note">
          <span className="app-footer__dot" aria-hidden="true" />
          Warehouse 01 / Simulation workspace
        </span>
        <span className="app-footer__stack">AGV-07 / Differential drive</span>
      </footer>
    </div>
  );
}

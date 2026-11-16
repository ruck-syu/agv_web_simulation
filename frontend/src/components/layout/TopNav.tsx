import { useEffect, useState } from 'react';
import { useSimulation } from '../../simulation/SimulationProvider';
import { ConnectionBadge } from '../dashboard/ConnectionBadge';
import { Icon } from '../ui/Icon';

interface TopNavProps { isFullscreen: boolean; onToggleFullscreen: () => void }
export function TopNav({ isFullscreen, onToggleFullscreen }: TopNavProps) {
  const [dark, setDark] = useState(() => document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') !== 'light');
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === 'agv-theme' || event.key === null) {
      const theme = event.newValue === 'light' ? 'light' : 'dark';
      document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme); setDark(theme === 'dark');
    } };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, []);
  const toggleTheme = () => {
    const next = dark ? 'light' : 'dark';
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', next);
    try { localStorage.setItem('agv-theme', next); } catch { /* Theme works when storage is blocked. */ }
    setDark(!dark);
  };
  const { snapshot } = useSimulation();
  const live = snapshot.connectionStatus === 'connected' && !snapshot.stale;
  return <header className="top-nav">
    <div className="brand">
      <span className="brand__mark" aria-hidden="true"><Icon name="robot" size={26} /></span>
      <h1>Warehouse control</h1>
      <span className="brand__site">Warehouse 01</span>
    </div>
    <div className="top-nav__meta">
      <span className={`robot-link ${live ? 'is-live' : ''}`}>
        <span aria-hidden="true" />{live ? 'Robot online' : 'Waiting for robot'}
      </span>
      <ConnectionBadge compact />
      <button type="button" className="icon-text-button theme-toggle" role="switch" aria-checked={dark} aria-label="Dark mode" onClick={toggleTheme}>{dark ? 'Dark mode' : 'Light mode'}</button>
      <button type="button" className="icon-text-button" onClick={onToggleFullscreen}
        title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}>
        <Icon name={isFullscreen ? 'minimize' : 'maximize'} size={17} />
        <span>{isFullscreen ? 'Exit full screen' : 'Full screen'}</span>
      </button>
    </div>
  </header>;
}

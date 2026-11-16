import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type CameraMode = 'overview' | 'follow' | 'close';
export type CameraCommandType = 'overview' | 'racks' | 'follow' | 'focus' | 'close';

export interface CameraCommand {
  type: CameraCommandType;
  token: number;
}

interface ViewportContextValue {
  mode: CameraMode;
  followEnabled: boolean;
  command: CameraCommand;
  collisionDebugVisible: boolean;
  setCollisionDebugVisible: (visible: boolean) => void;
  toggleCollisionDebug: () => void;
  selectOverview: () => void;
  selectStorage: () => void;
  selectFollow: () => void;
  selectCloseView: () => void;
  focusAgv: () => void;
  setFollowEnabled: (enabled: boolean) => void;
  resetView: () => void;
}

const ViewportContext = createContext<ViewportContextValue | null>(null);

export function ViewportProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<CameraMode>('overview');
  const [command, setCommand] = useState<CameraCommand>({ type: 'overview', token: 0 });
  const [collisionDebugVisible, setCollisionDebugVisible] = useState(false);

  const issueCommand = useCallback((type: CameraCommandType) => {
    setCommand((previous) => ({ type, token: previous.token + 1 }));
  }, []);

  const selectOverview = useCallback(() => {
    setMode('overview');
    issueCommand('overview');
  }, [issueCommand]);

  const selectStorage = useCallback(() => {
    setMode('overview');
    issueCommand('racks');
  }, [issueCommand]);

  const selectFollow = useCallback(() => {
    setMode('follow');
    issueCommand('follow');
  }, [issueCommand]);

  const selectCloseView = useCallback(() => {
    setMode('close');
    issueCommand('close');
  }, [issueCommand]);

  const focusAgv = useCallback(() => {
    setMode('follow');
    issueCommand('focus');
  }, [issueCommand]);

  const setFollowEnabled = useCallback(
    (enabled: boolean) => {
      if (!enabled) {
        setMode('overview');
        return;
      }
      if (mode === 'close') return;
      setMode('follow');
      issueCommand('follow');
    },
    [issueCommand, mode],
  );

  const resetView = useCallback(() => {
    setMode('overview');
    issueCommand('overview');
  }, [issueCommand]);

  const toggleCollisionDebug = useCallback(() => {
    setCollisionDebugVisible((visible) => !visible);
  }, []);

  const value = useMemo<ViewportContextValue>(
    () => ({
      mode,
      followEnabled: mode !== 'overview',
      command,
      collisionDebugVisible,
      setCollisionDebugVisible,
      toggleCollisionDebug,
      selectOverview,
      selectStorage,
      selectFollow,
      selectCloseView,
      focusAgv,
      setFollowEnabled,
      resetView,
    }),
    [
      collisionDebugVisible,
      command,
      focusAgv,
      mode,
      resetView,
      selectCloseView,
      selectFollow,
      selectOverview,
      selectStorage,
      setFollowEnabled,
      toggleCollisionDebug,
    ],
  );

  return <ViewportContext.Provider value={value}>{children}</ViewportContext.Provider>;
}

export function useViewport(): ViewportContextValue {
  const context = useContext(ViewportContext);
  if (!context) {
    throw new Error('useViewport must be used inside ViewportProvider.');
  }
  return context;
}

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { APP_CONFIG } from '../config/appConfig';
import { Icon } from '../components/ui/Icon';
import { useSimulation } from './SimulationProvider';

import { useFleet } from '../fleet/FleetProvider';
import { useRobotId } from '../fleet/RobotContext';
import { useGamepadDrive } from './useGamepadDrive';

type Direction = 'forward' | 'backward' | 'left' | 'right';

const DIRECTION_LABELS: Record<Direction, string> = {
  forward: 'Forward',
  backward: 'Backward',
  left: 'Turn left',
  right: 'Turn right',
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    (target instanceof HTMLInputElement && !['radio', 'checkbox', 'button', 'submit', 'reset', 'range', 'color'].includes(target.type)) ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export function SimulationControls() {
  const { fleet, live: fleetLive } = useFleet();
  const robotId = useRobotId();
  const safetyStop = !!fleet?.safety_stop;
  const { snapshot, sendTwist, stopRobot } = useSimulation();
  const [linearSpeed, setLinearSpeed] = useState<number>(
    APP_CONFIG.simulation.defaultLinearSpeed,
  );
  const [angularSpeed, setAngularSpeed] = useState<number>(
    APP_CONFIG.simulation.defaultAngularSpeed,
  );
  const controllerId = useId();
  const [controllerEnabled, setControllerEnabled] = useState(false);
  const [active, setActive] = useState<Direction | null>(null);
  const linearRef = useRef(linearSpeed);
  const angularRef = useRef(angularSpeed);
  const activeRef = useRef<Direction | null>(null);
  const timerRef = useRef<number | null>(null);
  const connected = snapshot.connectionStatus === 'connected';

  linearRef.current = linearSpeed;
  angularRef.current = angularSpeed;

  const driveReady = connected && !snapshot.stale && fleetLive;
  const gamepad = useGamepadDrive(controllerEnabled, driveReady,
    safetyStop ? Math.min(linearSpeed, .2) : linearSpeed, safetyStop ? Math.min(angularSpeed, .3) : angularSpeed, sendTwist);
  linearRef.current = safetyStop ? Math.min(linearSpeed, .2) : linearSpeed;
  angularRef.current = safetyStop ? Math.min(angularSpeed, .3) : angularSpeed;

  const publishActive = useCallback(() => {
    const direction = activeRef.current;
    if (!direction) return;
    if (direction === 'forward') {
      sendTwist(linearRef.current, 0);
    } else if (direction === 'backward') {
      sendTwist(-linearRef.current, 0);
    } else if (direction === 'left') {
      sendTwist(0, angularRef.current);
    } else {
      sendTwist(0, -angularRef.current);
    }
  }, [sendTwist]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopHold = useCallback(
    (sendZero = true) => {
      clearTimer();
      if (activeRef.current !== null) {
        activeRef.current = null;
        setActive(null);
      }
      gamepad.reset();
      if (sendZero) stopRobot();
    },
    [clearTimer, stopRobot, gamepad.reset],
  );

  const startHold = useCallback(
    (direction: Direction) => {
      if (!driveReady || controllerEnabled) return;
      if (activeRef.current === direction && timerRef.current !== null) return;
      clearTimer();
      activeRef.current = direction;
      setActive(direction);
      publishActive();
      timerRef.current = window.setInterval(
        publishActive,
        APP_CONFIG.simulation.cmdPublishIntervalMs,
      );
    },
    [clearTimer, driveReady, controllerEnabled, publishActive],
  );

  // Reset on entry to a fleet stop, but allow a fresh retreat gesture while it persists.
  useEffect(() => {
    if (!driveReady || safetyStop) stopHold(true);
  }, [driveReady, safetyStop, stopHold]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      let direction: Direction | null = null;
      if (key === 'w' || key === 'arrowup') direction = 'forward';
      else if (key === 's' || key === 'arrowdown') direction = 'backward';
      else if (key === 'a' || key === 'arrowleft') direction = 'left';
      else if (key === 'd' || key === 'arrowright') direction = 'right';
      else if (key === ' ' || key === 'escape') {
        event.preventDefault();
        stopHold(true);
        return;
      }
      if (!direction) return;
      event.preventDefault();
      startHold(direction);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      let direction: Direction | null = null;
      if (key === 'w' || key === 'arrowup') direction = 'forward';
      else if (key === 's' || key === 'arrowdown') direction = 'backward';
      else if (key === 'a' || key === 'arrowleft') direction = 'left';
      else if (key === 'd' || key === 'arrowright') direction = 'right';
      if (direction && activeRef.current === direction) {
        event.preventDefault();
        stopHold(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startHold, stopHold]);

  useEffect(
    () => () => {
      clearTimer();
      try {
        if (activeRef.current !== null) sendTwist(0, 0);
      } catch {
        return;
      }
    },
    [clearTimer, sendTwist],
  );

  useEffect(() => {
    const stopOnFocusLoss = () => { if (activeRef.current !== null) stopHold(true); };
    const stopWhenHidden = () => { if (document.visibilityState === 'hidden') stopOnFocusLoss(); };
    window.addEventListener('blur', stopOnFocusLoss);
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => {
      window.removeEventListener('blur', stopOnFocusLoss);
      document.removeEventListener('visibilitychange', stopWhenHidden);
    };
  }, [stopHold]);

  const bindHold = (direction: Direction) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      startHold(direction);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (activeRef.current === direction) stopHold(true);
    },
    onPointerCancel: () => {
      if (activeRef.current === direction) stopHold(true);
    },
    onLostPointerCapture: () => {
      if (activeRef.current === direction) stopHold(true);
    },
  });

  return (
    <div className="drive-controls">
      <p className="drive-instruction">Hold a direction to move. Release to stop.</p>


      <div className="drive-pad" role="group" aria-label="AGV drive controls">
        <button
          type="button"
          className={`drive-button drive-button--forward ${active === 'forward' ? 'is-active' : ''}`.trim()}
          disabled={!driveReady || controllerEnabled}
          aria-label="Drive forward"
          {...bindHold('forward')}
        >
          <Icon name="arrow-up" size={19} />
          <span>{DIRECTION_LABELS.forward}</span>
        </button>
        <button
          type="button"
          className={`drive-button drive-button--left ${active === 'left' ? 'is-active' : ''}`.trim()}
          disabled={!driveReady || controllerEnabled}
          aria-label="Turn left"
          {...bindHold('left')}
        >
          <Icon name="arrow-left" size={19} />
          <span>{DIRECTION_LABELS.left}</span>
        </button>
        <button
          type="button"
          className="drive-button drive-button--stop"
          disabled={!connected}
          aria-label="Stop the AGV"
          onClick={() => stopHold(true)}
        >
          <Icon name="stop" size={18} />
          <span>Stop</span>
        </button>
        <button
          type="button"
          className={`drive-button drive-button--right ${active === 'right' ? 'is-active' : ''}`.trim()}
          disabled={!driveReady || controllerEnabled}
          aria-label="Turn right"
          {...bindHold('right')}
        >
          <Icon name="arrow-right" size={19} />
          <span>{DIRECTION_LABELS.right}</span>
        </button>
        <button
          type="button"
          className={`drive-button drive-button--backward ${active === 'backward' ? 'is-active' : ''}`.trim()}
          disabled={!driveReady || controllerEnabled}
          aria-label="Drive backward"
          {...bindHold('backward')}
        >
          <Icon name="arrow-down" size={19} />
          <span>{DIRECTION_LABELS.backward}</span>
        </button>
      </div>

      <div className="speed-controls">
        <label className="speed-control">
          <span>
            Linear speed
            <strong>{linearSpeed.toFixed(2)} m/s</strong>
          </span>
          <input
            type="range"
            min={0.05}
            max={APP_CONFIG.simulation.maxLinearSpeed}
            step={0.05}
            value={linearSpeed}
            onChange={(event) => setLinearSpeed(Number(event.target.value))}
          />
        </label>
        <label className="speed-control">
          <span>
            Angular speed
            <strong>{angularSpeed.toFixed(2)} rad/s</strong>
          </span>
          <input
            type="range"
            min={0.1}
            max={APP_CONFIG.simulation.maxAngularSpeed}
            step={0.1}
            value={angularSpeed}
            onChange={(event) => setAngularSpeed(Number(event.target.value))}
          />
        </label>
      </div>

      <p className="drive-controls__hint">
        Keys <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrows. <kbd>Space</kbd> stops.
      </p>

      <div className="controller-controls">
        <label htmlFor={controllerId}>
          <input id={controllerId} type="checkbox" checked={controllerEnabled}
            aria-describedby={controllerEnabled ? `${controllerId}-help` : undefined}
            onChange={(event) => { stopHold(true); setControllerEnabled(event.target.checked); }} />
          Enable gamepad driving
        </label>
        {controllerEnabled && <><p className="drive-controls__hint" id={`${controllerId}-help`}>
          Left stick: forward/reverse and turn. Hold <strong>RB / R1</strong> to drive.
          Release to stop. <strong>B / Circle</strong>: stop and disarm. Speed sliders set maximum speeds.
          Center the stick and release RB/R1 to arm after enabling or a safety stop.
        </p>
        <p className="drive-controls__hint">{gamepad.report}</p></>}
      </div>


      {safetyStop && <p className="form-hint form-hint--warning">Fleet safety stop: release controls, then use a fresh gesture to retreat. Backend permits separation-increasing motion only, up to 0.2 m/s and 0.3 rad/s. Stop below 3.0 m; clears at 3.3 m.</p>}
      {connected && !fleetLive && <p className="form-hint form-hint--warning">Fresh /fleet/state required for manual driving.</p>}
      {connected && snapshot.stale && (
        <p className="form-hint form-hint--warning">
          ROS bridge is connected but no fresh /{robotId}/agv_web/ground_truth has arrived. Start the Python simulation node.
        </p>
      )}
      {snapshot.commandError && (
        <p className="form-hint form-hint--error">{snapshot.commandError}</p>
      )}
    </div>
  );
}

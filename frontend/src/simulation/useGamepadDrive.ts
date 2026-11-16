import { useCallback, useEffect, useRef, useState } from 'react';
import { GamepadDriver } from './gamepad';

export function useGamepadDrive(enabled: boolean, ready: boolean, linear: number, angular: number,
  sendTwist: (linear: number, angular: number) => boolean) {
  const driver = useRef(new GamepadDriver());
  const input = useRef({ ready, linear, angular });
  input.current = { ready, linear, angular };
  const [report, setReport] = useState('Gamepad driving disabled');
  const reset = useCallback(() => {
    const command = driver.current.reset();
    if (command) sendTwist(...command);
  }, [sendTwist]);
  useEffect(() => {
    if (!enabled) { reset(); setReport('Gamepad driving disabled'); return; }
    if (!window.isSecureContext || typeof navigator.getGamepads !== 'function') {
      setReport('Gamepad API unavailable — use localhost or HTTPS in a supported browser');
      return;
    }
    let focused = document.hasFocus();
    const poll = () => {
      try {
        const pads = Array.from(navigator.getGamepads()).filter((pad) => pad?.connected);
        const pad = pads.find((pad) => pad?.mapping === 'standard') ?? pads[0] ?? null;
        const current = input.current;
        const command = driver.current.step(pad, current.ready && focused && document.visibilityState === 'visible',
          performance.now(), current.linear, current.angular);
        if (command && !sendTwist(...command)) reset();
        const message = `${pad ? `${pad.id} · ` : ''}${driver.current.status}`;
        setReport((previous) => previous === message ? previous : message);
      } catch {
        reset();
        setReport('Controller access blocked by browser permissions');
      }
    };
    const blur = () => { focused = false; reset(); };
    const focus = () => { focused = true; };
    const visibility = () => { if (document.visibilityState !== 'visible') reset(); };
    const disconnect = () => { reset(); poll(); };
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('gamepaddisconnected', disconnect);
    poll();
    const timer = window.setInterval(poll, 100);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('gamepaddisconnected', disconnect);
      reset();
    };
  }, [enabled, reset, sendTwist]);
  return { report, reset };
}

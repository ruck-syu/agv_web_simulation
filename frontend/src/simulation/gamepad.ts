/** Standard-mapped controllers only: left stick drives, right bumper is deadman. */
export interface DrivePad {
  id: string;
  index: number;
  mapping: string;
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}
export type PadCommand = [number, number] | null;
export const GAMEPAD_DEAD_ZONE = 0.15;

export function stick(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.abs(clamped) <= GAMEPAD_DEAD_ZONE ? 0 :
    Math.sign(clamped) * (Math.abs(clamped) - GAMEPAD_DEAD_ZONE) / (1 - GAMEPAD_DEAD_ZONE);
}

export class GamepadDriver {
  private identity = '';
  private armed = false;
  private driving = false;
  private lastPoll: number | null = null;
  private stopHeld = false;
  status = 'Release RB/R1 and center the left stick to arm';

  reset(): PadCommand {
    const command: PadCommand = this.driving ? [0, 0] : null;
    this.armed = false;
    this.driving = false;
    this.lastPoll = null;
    this.status = 'Release RB/R1 and center the left stick to arm';
    return command;
  }

  step(pad: DrivePad | null, ready: boolean, now: number, linear: number, angular: number): PadCommand {
    if (!pad || !pad.connected || pad.mapping !== 'standard' || pad.axes.length < 2 || pad.buttons.length < 6 ||
        !Number.isFinite(pad.axes[0]) || !Number.isFinite(pad.axes[1])) {
      const command = this.reset();
      this.identity = '';
      this.status = pad ? 'This controller needs a standard browser mapping' : 'Connect a controller and press any button';
      return command;
    }
    if (!ready) {
      const command = this.reset();
      this.status = 'Waiting for fresh ROS telemetry and a focused tab';
      return command;
    }
    const identity = `${pad.index}:${pad.id}`;
    if (identity !== this.identity || (this.lastPoll !== null && now - this.lastPoll > 300)) {
      const command = this.reset();
      this.identity = identity;
      this.lastPoll = now;
      return command;
    }
    this.lastPoll = now;
    const deadman = pad.buttons[5].pressed;
    const stop = pad.buttons[1].pressed;
    if (stop) {
      const firstPress = !this.stopHeld;
      const command = this.reset();
      this.stopHeld = true;
      this.status = 'Controller stop pressed; release RB/R1 and center the stick';
      return firstPress ? [0, 0] : command;
    }
    this.stopHeld = false;
    const forward = -stick(pad.axes[1]), turn = -stick(pad.axes[0]);
    if (!this.armed) {
      if (!deadman && forward === 0 && turn === 0) {
        this.armed = true;
        this.status = 'Ready — hold RB/R1 to drive';
      }
      return null;
    }
    if (!deadman) {
      const command: PadCommand = this.driving ? [0, 0] : null;
      this.driving = false;
      this.status = 'Ready — hold RB/R1 to drive';
      return command;
    }
    this.driving = true;
    this.status = 'Driving — release RB/R1 to stop';
    return [forward * linear, turn * angular];
  }
}

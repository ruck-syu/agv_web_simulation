import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadDriver, stick } from '../src/simulation/gamepad.ts';
const pad = (axes = [0, 0], held = false, stop = false) => ({ id: 'Test controller', index: 0,
  mapping: 'standard', connected: true, axes,
  buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: index === 5 ? held : index === 1 ? stop : false })) });
function armed() { const driver = new GamepadDriver(); driver.step(pad(), true, 0, 0.4, 0.8); driver.step(pad(), true, 100, 0.4, 0.8); return driver; }
test('dead zone is continuous, signed and bounded', () => {
  assert.equal(stick(0.15), 0); assert.equal(stick(-0.1), 0);
  assert.equal(stick(1), 1); assert.equal(stick(-2), -1); assert.equal(stick(NaN), 0);
  assert.ok(Math.abs(stick(0.575) - 0.5) < 1e-10);
});
test('requires released deadman and neutral axes before arming', () => {
  const driver = new GamepadDriver();
  for (let now = 0; now < 500; now += 100) assert.equal(driver.step(pad([0, -1], true), true, now, 0.4, 0.8), null);
  assert.equal(driver.step(pad(), true, 500, 0.4, 0.8), null);
  assert.deepEqual(driver.step(pad([-1, -1], true), true, 600, 0.4, 0.8), [0.4, 0.8]);
});
test('maps forward, reverse and turn to configured speed caps', () => {
  const driver = armed();
  assert.deepEqual(driver.step(pad([-1, -1], true), true, 200, 0.4, 0.8), [0.4, 0.8]);
  assert.deepEqual(driver.step(pad([1, 1], true), true, 300, 0.2, 0.6), [-0.2, -0.6]);
});
test('release emits one stop and idle does not interfere with autonomy', () => {
  const driver = armed();
  assert.equal(driver.step(pad(), true, 200, 0.4, 0.8), null);
  driver.step(pad([0, -1], true), true, 300, 0.4, 0.8);
  assert.deepEqual(driver.step(pad(), true, 400, 0.4, 0.8), [0, 0]);
  assert.equal(driver.step(pad(), true, 500, 0.4, 0.8), null);
});
test('stop button disarms and held deadman cannot resume', () => {
  const driver = armed();
  driver.step(pad([0, -1], true), true, 200, 0.4, 0.8);
  assert.deepEqual(driver.step(pad([0, -1], true, true), true, 300, 0.4, 0.8), [0, 0]);
  assert.equal(driver.step(pad([0, -1], true), true, 400, 0.4, 0.8), null);
});
test('disconnect, invalid mapping and stale telemetry stop and require rearming', () => {
  for (const fault of [null, { ...pad(), mapping: '' }, { ...pad(), axes: [NaN, 0] }]) {
    const driver = armed(); driver.step(pad([0, -1], true), true, 200, 0.4, 0.8);
    assert.deepEqual(driver.step(fault, true, 300, 0.4, 0.8), [0, 0]);
    assert.equal(driver.step(pad([0, -1], true), true, 400, 0.4, 0.8), null);
  }
  const driver = armed(); driver.step(pad([0, -1], true), true, 200, 0.4, 0.8);
  assert.deepEqual(driver.step(pad([0, -1], true), false, 300, 0.4, 0.8), [0, 0]);
  assert.equal(driver.step(pad([0, -1], true), true, 400, 0.4, 0.8), null);
});
test('focus loss reset and polling stalls cannot replay held controls', () => {
  const driver = armed(); driver.step(pad([0, -1], true), true, 200, 0.4, 0.8);
  assert.deepEqual(driver.step(pad([0, -1], true), true, 1000, 0.4, 0.8), [0, 0]);
  assert.equal(driver.step(pad([0, -1], true), true, 1100, 0.4, 0.8), null);
  driver.step(pad(), true, 1200, 0.4, 0.8);
  driver.step(pad([0, -1], true), true, 1300, 0.4, 0.8);
  assert.deepEqual(driver.reset(), [0, 0]);
  assert.equal(driver.step(pad([0, -1], true), true, 1400, 0.4, 0.8), null);
});
test('switching controllers stops the previous input source', () => {
  const driver = armed(); driver.step(pad([0, -1], true), true, 200, 0.4, 0.8);
  assert.deepEqual(driver.step({ ...pad([0, -1], true), id: 'Replacement' }, true, 300, 0.4, 0.8), [0, 0]);
});

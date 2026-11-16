import { test, expect } from '@playwright/test';

test('virtual standard controller drives only while armed and stops on release, focus loss, stale telemetry and unplug', async ({ page }) => {
  let pauseTruth = false;
  const commands: { linear: { x: number }; angular: { z: number } }[] = [];
  await page.route(/\/src\/warehouse\/WarehouseCanvas\.tsx(?:\?.*)?$/, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: 'export function WarehouseCanvas() { return null; }' }));
  await page.addInitScript(() => {
    const state = window as unknown as { testPad: object | null };
    state.testPad = { id: 'Virtual standard controller', index: 0, mapping: 'standard', connected: true,
      axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [state.testPad] });

  });
  await page.routeWebSocket('ws://localhost:9090', (socket) => {
    socket.onMessage((raw) => { const message = JSON.parse(String(raw)); if (message.op === 'publish' && message.topic === '/agv_web/manual_cmd_vel') commands.push(message.msg); });
    const truth = { header: { frame_id: 'world' }, child_frame_id: 'ground_truth_base_link',
      pose: { pose: { position: { x: -2.8, y: 1.6 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } },
      twist: { twist: { linear: { x: 0 }, angular: { z: 0 } } } };
    const timer = setInterval(() => { if (!pauseTruth) socket.send(JSON.stringify({ op: 'publish', topic: '/agv_web/ground_truth', msg: truth })); }, 100);
    socket.onClose(() => clearInterval(timer));
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Drive forward', exact: true })).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Enable gamepad driving' }).check();
  await expect(page.getByText(/Virtual standard controller.*Ready — hold RB/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Drive forward', exact: true })).toBeDisabled();
  const lastLinear = async () => commands.at(-1)?.linear.x;
  const drive = () => page.evaluate(() => { const pad = (window as any).testPad; pad.axes = [0, -1]; pad.buttons[5].pressed = true; });
  const release = () => page.evaluate(() => { const pad = (window as any).testPad; pad.axes = [0, 0]; pad.buttons[5].pressed = false; });
  await drive();
  await expect.poll(lastLinear).toBeGreaterThan(0);
  await release();
  await expect.poll(lastLinear).toBe(0);
  const idleCount = commands.length;
  await page.waitForTimeout(400);
  expect(commands.length).toBe(idleCount);
  await drive();
  await expect.poll(lastLinear).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(lastLinear).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(250);
  expect(await lastLinear()).toBe(0);
  await release();
  await expect(page.getByText(/Virtual standard controller.*Ready — hold RB/)).toBeVisible();
  await drive();
  await expect.poll(lastLinear).toBeGreaterThan(0);
  pauseTruth = true;
  await expect.poll(lastLinear, { timeout: 4000 }).toBe(0);
  pauseTruth = false;
  await release();
  await expect(page.getByText(/Virtual standard controller.*Ready — hold RB/)).toBeVisible();
  await drive();
  await expect.poll(lastLinear).toBeGreaterThan(0);
  await page.evaluate(() => { (window as any).testPad = null; });
  await expect.poll(lastLinear).toBe(0);
  await expect(page.getByText('Connect a controller and press any button', { exact: true })).toBeVisible();
});

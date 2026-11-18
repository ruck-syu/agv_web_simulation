import { test, expect } from '@playwright/test';
test('live fleet sensors and connection recovery', async ({ page }) => {
  let fleetSeen = false;
  page.on('websocket', socket => socket.on('framereceived', event => {
    try { if (JSON.parse(String(event.payload)).topic === '/fleet/state') fleetSeen = true; } catch {}
  }));
  await page.goto('/');
  await expect.poll(() => fleetSeen, { timeout: 5000 }).toBe(true).catch(() => {
    console.log('No /fleet/state frame observed within 5s; live-fleet assertions will be skipped.');
  });
  if (process.env.AGV_FLEET_E2E === '1') expect(fleetSeen, 'AGV_FLEET_E2E requires live /fleet/state').toBe(true);
  test.skip(!fleetSeen, 'Live fleet ROS topics (/fleet/state) not observed; requires the agv_fleet.launch.py stack.');
  const panel = (name:string) => page.locator('section.panel').filter({has:page.getByRole('heading',{name,exact:true})});
  for (const id of ['agv1','agv2']) {
    await page.getByRole('radio',{name:id,exact:true}).check();
    await expect(panel('LiDAR · 3D scan view')).toContainText('Live scan');
    await expect(page.getByRole('button',{name:'Navigate to goal',exact:true})).toBeEnabled();
  }
  await page.locator('.diagnostics-disclosure > summary').click();
  await page.getByRole('button',{name:'Disconnect',exact:true}).click();
  await expect(page.getByRole('button',{name:'Navigate to goal',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Stop all',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Connect now',exact:true}).click();
  await expect(panel('LiDAR · 3D scan view')).toContainText('Live scan');
});

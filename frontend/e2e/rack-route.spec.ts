import { test, expect } from '@playwright/test';

test('rack preview works offline, dark theme persists, and warehouse renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.routeWebSocket('ws://localhost:9090', socket => { socket.onMessage(() => {}); });
  await page.goto('/');
  const theme = page.getByRole('switch', { name: 'Dark mode' });
  await expect(theme).toBeChecked();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await theme.click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.reload();
  await expect(theme).not.toBeChecked();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await theme.click();
  await page.getByRole('combobox', {name:'Source rack',exact:true}).selectOption('A1');
  await page.getByRole('combobox', {name:'Destination rack',exact:true}).selectOption('D2');
  await expect(page.getByRole('img', { name: /Warehouse route preview from A1 to D2/ })).toBeVisible();
  await expect(page.locator('.route-map polyline')).not.toHaveAttribute('points', '');
  await expect(page.locator('.warehouse-canvas canvas')).toBeVisible();
  await expect(page.getByText('Obstacle sensing unavailable', {exact:true})).toBeVisible();
  await page.getByRole('combobox', {name:'Destination rack',exact:true}).selectOption('A1');
  await expect(page.getByRole('button', {name:'Start rack route',exact:true})).toBeDisabled();
  expect(errors).toEqual([]);
});

test('rack journey sends map-frame goals in sequence and LiDAR warns of nearby obstacles', async ({ page }) => {
  const commands: any[] = [], subscriptions: any[] = [];
  let delayedFrames = 0;
  let goal: number[] | null = null, state = 'idle', busy = false, pause = false, delayedTransform = true;
  await page.route(/\/src\/warehouse\/WarehouseCanvas\.tsx(?:\?.*)?$/, route => route.fulfill({contentType:'application/javascript',body:'export function WarehouseCanvas(){return null;}'}));
  await page.routeWebSocket('ws://localhost:9090', socket => {
    socket.onMessage(raw => {
      const msg = JSON.parse(String(raw));
      if (msg.op === 'subscribe') subscriptions.push(msg);
      if (msg.op !== 'publish' || msg.topic !== '/agv_web/navigation_command') return;
      const command = JSON.parse(msg.msg.data); commands.push(command);
      if(command.action === 'goal') { goal=[command.x,command.y,command.yaw]; state='navigating'; busy=true; }
      if(command.action === 'cancel') { state='canceled';busy=false; }
    });
    const send = (topic:string,msg:unknown) => socket.send(JSON.stringify({op:'publish',topic,msg}));
    const odom = (frame:string, child:string, x:number,y:number) => ({header:{frame_id:frame},child_frame_id:child,pose:{pose:{position:{x,y},orientation:{x:0,y:0,z:0,w:1}}},twist:{twist:{linear:{x:0},angular:{z:0}}}});
    const timer = setInterval(() => {
      if(pause) return;
      send('/agv_web/ground_truth', odom('world','ground_truth_base_link',-2.8,1.6));
      send('/odom', odom('odom','base_link',0,0));
      if (delayedTransform) delayedFrames++;
      const stamp = Date.now() - (delayedTransform ? 5000 : 0);
      send('/tf',{transforms:[{header:{frame_id:'map',stamp:{sec:Math.floor(stamp/1000),nanosec:(stamp%1000)*1000000}},child_frame_id:'odom',transform:{translation:{x:10,y:5},rotation:{z:0,w:1}}}]});
      send('/agv_web/navigation_status',{data:JSON.stringify({state,detail:state,mode:busy?'autonomous':'manual',busy,server_ready:true,sensors_ready:true,localization_ready:true,operator_ready:true,goal})});
      send('/scan',{header:{frame_id:'laser_frame'},angle_min:-Math.PI,angle_increment:Math.PI/2,range_min:.1,range_max:20,ranges:[8,1.2,null,5]});
    },100);
    socket.onClose(()=>clearInterval(timer));
  });
  await page.goto('/');
  await expect(page.getByText('OBSTACLE · Nearby return',{exact:true})).toBeVisible();
  await expect(page.locator('.route-summary')).toContainText(' m');
  // Wait for all localization topics to arrive before dispatch.
  await expect(page.getByRole('button',{name:'Navigate to goal',exact:true})).toBeEnabled();
  await expect.poll(()=>delayedFrames).toBeGreaterThanOrEqual(5);
  expect(subscriptions.find(s=>s.topic==='/agv_web/ground_truth').throttle_rate).toBe(100);
  expect(subscriptions.find(s=>s.topic==='/tf').throttle_rate).toBe(0);
  // Regression: queued old TF must not re-enable travel just because it arrived now.
  await expect(page.getByRole('button',{name:'Start rack route',exact:true})).toBeDisabled();
  delayedTransform=false;
  await expect(page.getByRole('button',{name:'Start rack route',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Start rack route',exact:true}).click();
  await expect.poll(()=>commands.filter(c=>c.action==='goal').length).toBe(1);
  expect(commands[0].x).toBeCloseTo(.8,4); expect(commands[0].y).toBeCloseTo(5.68,4);
  await expect(page.getByText('Travelling to source rack',{exact:true})).toBeVisible();
  await page.waitForTimeout(250);
  state='succeeded'; busy=false;
  await expect.poll(()=>commands.filter(c=>c.action==='goal').length).toBe(2);
  expect(commands[1].x).toBeCloseTo(.8,4); expect(commands[1].y).toBeCloseTo(-3.28,4);
  await expect(page.getByText('Travelling to destination rack',{exact:true})).toBeVisible();
  pause=true;
  await expect(page.getByText('Interrupted',{exact:true})).toBeVisible({timeout:5000});
  await expect(page.getByText('Obstacle sensing unavailable',{exact:true})).toBeVisible();
});

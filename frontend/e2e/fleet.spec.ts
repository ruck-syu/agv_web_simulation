import { test, expect } from '@playwright/test';

test('parallel rack jobs, robot switching, watchdogs, reservations and stop all', async ({ page }) => {
  const commands: {id:string; action:string; x?:number; y?:number}[] = [];
  const heartbeats = {agv1:0,agv2:0};
  const manual: {id:string; x:number}[] = [];
  const robots: Record<string, any> = Object.fromEntries(['agv1','agv2'].map(id => [id, {
    state:'idle', detail:'Ready', mode:'manual', ready:true, busy:false, goal:null,
    pose:[id === 'agv1' ? -2.8 : 4.5,1.6,0], waiting_on:[],
  }]));
  let pauseFleet = false, pauseTruth = false, safety = false, rejectPair = false, withholdPairAck = false;
  const pairs: {request_id: string; goals: Record<string, any>; destinations: Record<string, any>}[] = [];
  const fleetStops: string[] = [];
  const timedOutPairs: string[] = [];
  let disconnect = () => {};
  const heartbeatPayloads: unknown[] = [];
  const subscriptions = new Set<string>();
  const errors:string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as any;
    state.testPad = {id:'Fleet virtual pad',index:0,mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};
    Object.defineProperty(navigator,'getGamepads',{value:()=>[state.testPad]});
  });
  await page.route(/\/src\/warehouse\/WarehouseCanvas\.tsx(?:\?.*)?$/, route => route.fulfill({contentType:'application/javascript',body:'export function WarehouseCanvas(){return null;}'}));
  await page.routeWebSocket('ws://localhost:9090', socket => {
    disconnect = () => socket.close();
    socket.onMessage(raw => {
      const m = JSON.parse(String(raw));
      if (m.op === 'subscribe') subscriptions.add(m.topic);
      if (m.op !== 'publish') return;
      if (m.topic === '/fleet/start_pair') {
        const pair = JSON.parse(m.msg.data);
        if (pair.action === 'stop') {
          fleetStops.push(pair.action);
          for (const r of Object.values(robots)) {
            Object.assign(r,{state:'canceled',detail:'Operator stop',mode:'manual',busy:false,goal:null});
          }
          return;
        }
        if (pair.action === 'cancel') {
          timedOutPairs.push(pair.request_id);
          return;
        }
        pairs.push(pair);
        if (withholdPairAck) return;
        if (rejectPair) {
          socket.send(JSON.stringify({op:'publish',topic:'/fleet/start_pair_result',
            msg:{data:JSON.stringify({request_id:pair.request_id,issues:{agv2:'Floor scan just expired.'}})}}));
        } else {
          for (const [id, c] of Object.entries(pair.goals) as [string, any][]) {
            Object.assign(robots[id], {request_id:pair.request_id,pair_leg:0,state:'navigating',detail:'Following reserved world route',mode:'autonomous',busy:true,goal:[c.x,c.y,c.yaw]});
          }
        }
        return;
      }
      const id = m.topic.split('/')[1];
      if (!robots[id]) return;
      if (m.topic.endsWith('/operator_heartbeat')) { heartbeats[id as 'agv1'|'agv2']++; heartbeatPayloads.push(m.msg); }
      if (m.topic.endsWith('/manual_cmd_vel')) manual.push({id, x:m.msg.linear.x});
      if (!m.topic.endsWith('/navigation_command')) return;
      const c = JSON.parse(m.msg.data); commands.push({id,...c});
      if (c.action === 'goal') setTimeout(() => Object.assign(robots[id],{request_id:c.request_id,state:'navigating',detail:'Following reserved world route',mode:'autonomous',busy:true,goal:[c.x,c.y,c.yaw]}),300);
      else Object.assign(robots[id],{state:'canceled',detail:'Operator stop',mode:'manual',busy:false,goal:null});
    });
    const send = (topic:string,msg:unknown) => socket.send(JSON.stringify({op:'publish',topic,msg}));
    const timer = setInterval(() => {
      if (!pauseFleet) send('/fleet/state',{data:JSON.stringify({schema_version:1,frame_id:'world',safety_stop:safety,separation_m:safety?2.2:7.3,robots,
        reserved_zones:{agv1:robots.agv1.busy?[[-6,3]]:[],agv2:robots.agv2.busy?[[9,3]]:[]}})});
      for (const [id,r] of Object.entries(robots)) {
        const odom = (frame:string) => ({header:{frame_id:frame},child_frame_id:`${id}/${frame === "world" ? "ground_truth_base_link" : "base_link"}`,pose:{pose:{position:{x:r.pose[0],y:r.pose[1]},orientation:{x:0,y:0,z:0,w:1}}},twist:{twist:{linear:{x:0},angular:{z:0}}}});
        if (!pauseTruth || id === 'agv1') send(`/${id}/agv_web/ground_truth`,odom('world'));
        send(`/${id}/odom`,odom(`${id}/odom`));
        send(`/${id}/agv_web/collision_status`,{data:'malformed'});
        send(`/${id}/agv_web/navigation_status`,{data:JSON.stringify(r)});
        send(`/${id}/scan`,{header:{frame_id:`${id}/laser_frame`},angle_min:0,angle_increment:1,range_min:.1,range_max:20,ranges:[1,5,8,10]});
        send(`/${id}/plan`,{header:{frame_id:'world'},poses:[{pose:{position:{x:r.pose[0],y:r.pose[1]}}},{pose:{position:{x:0,y:0}}}]});
      }
    },100);
    socket.onClose(() => clearInterval(timer));
  });
  await page.goto('/');
  const start = page.getByRole('button',{name:'Start rack route',exact:true});
  const startBoth = page.getByRole('button',{name:'Start both',exact:true});
  const source = page.getByRole('combobox',{name:'Source rack',exact:true});
  const select = (id:string) => page.getByRole('radio',{name:id,exact:true}).check();
  await expect(start).toBeEnabled();
  await expect(startBoth).toBeDisabled();
  await select('agv2');
  await source.selectOption('D1');
  await expect(startBoth).toBeDisabled();
  await expect(page.getByText('agv2: No valid source/destination route.')).toBeVisible();
  expect(pairs).toHaveLength(0);
  await source.selectOption('A1');
  await page.getByRole('combobox',{name:'Destination rack',exact:true}).selectOption('A2');
  await expect(startBoth).toBeEnabled();
  pauseTruth = true;
  await expect(startBoth).toBeDisabled();
  await expect(page.getByText('agv2: World telemetry or odometry stale.')).toBeVisible();
  pauseTruth = false;
  await expect(startBoth).toBeEnabled();
  await select('agv1');
  expect(subscriptions.has('/agv_web/test')).toBe(false);
  expect(subscriptions.has('/agv_web/ack')).toBe(false);
  await page.locator('.diagnostics-disclosure > summary').click();
  for(const id of ['agv1','agv2']) {
    await expect(page.locator('.log-entry').filter({hasText:`${id} SIM`})).toContainText(`/${id}/agv_web/ground_truth`);
    await expect(page.locator('.log-entry').filter({hasText:`${id} SAFETY`})).toContainText('Ignored malformed collision');
  }
  await page.getByRole('checkbox',{name:'Show agv1 LiDAR returns in warehouse',exact:true}).uncheck();
  await start.click();
  await expect.poll(() => commands.filter(c=>c.id==='agv1' && c.action==='goal').length).toBe(1);
  const first = commands.find(c=>c.id==='agv1' && c.action==='goal')!;
  expect(first.x).toBeCloseTo(-12); // rack B2's world approach, without map conversion
  await expect(startBoth).toBeDisabled();
  await expect(page.getByText('agv1: Already running.')).toBeVisible();
  await select('agv2');
  await expect(page.getByRole('checkbox',{name:'Show agv2 LiDAR returns in warehouse',exact:true})).toBeChecked();
  await page.getByRole('combobox',{name:'Source rack',exact:true}).selectOption('A1');
  await page.getByRole('combobox',{name:'Destination rack',exact:true}).selectOption('A2');
  await expect(start).toBeEnabled(); await start.click();
  await expect.poll(() => commands.filter(c=>c.id==='agv2' && c.action==='goal').length).toBe(1);
  expect(commands.filter(c=>c.id==='agv1' && c.action!=='goal')).toHaveLength(0);
  const before = {...heartbeats};
  await expect.poll(() => heartbeats.agv1-before.agv1).toBeGreaterThan(2);
  await expect.poll(() => heartbeats.agv2-before.agv2).toBeGreaterThan(2);
  expect(heartbeatPayloads.length).toBeGreaterThan(0);
  expect(heartbeatPayloads.every(m => (m as any).data === 'alive')).toBe(true); // FleetNode.heartbeat accepts exactly this string
  // Backend success clears goal; remembered acknowledgement must advance the unselected job.
  Object.assign(robots.agv1,{state:'succeeded',mode:'manual',busy:false,goal:null});
  await expect.poll(() => commands.filter(c=>c.id==='agv1' && c.action==='goal').length).toBe(2);
  Object.assign(robots.agv2,{state:'waiting',waiting_on:['agv1']});
  await expect(page.locator('.fleet-robot').nth(1)).toContainText('Waiting on: agv1');
  await expect(page.locator('.fleet-robot').nth(0)).toContainText('Reserved tiles: 1');
  const canceledBeforeSafety = commands.filter(c=>c.action==='cancel').length;
  safety = true;
  await expect(page.getByRole('alert').filter({hasText:'autonomy canceled'})).toBeVisible();
  await expect.poll(() => commands.filter(c=>c.action==='cancel').length).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(500);
  expect(commands.filter(c=>c.action==='cancel').length - canceledBeforeSafety).toBe(2);
  await expect(startBoth).toBeDisabled();
  await expect(page.getByText('agv1: Safety stop active. agv2: Safety stop active.')).toBeVisible();
  safety = false;
  await expect(startBoth).toBeEnabled();
  rejectPair = true;
  await startBoth.click();
  await expect(page.getByText('agv2: Floor scan just expired.')).toBeVisible();
  expect(robots.agv1.busy).toBe(false);
  expect(robots.agv2.busy).toBe(false);
  rejectPair = false;
  await startBoth.click();
  await expect.poll(() => pairs.length).toBe(2);
  expect(pairs[1].request_id).toBeTruthy();
  expect(pairs[1].goals.agv1).toMatchObject({ action:'goal', x:-12, y:expect.closeTo(2.28) });
  expect(pairs[1].goals.agv2).toMatchObject({ action:'goal', x:-12, y:expect.closeTo(16.12) });
  await expect(startBoth).toBeDisabled();
  await expect(page.locator('.fleet-robot').nth(0)).toContainText('Travelling to source rack');
  await expect(page.locator('.fleet-robot').nth(1)).toContainText('Travelling to source rack');
  const priorGoals = commands.filter(c=>c.action==='goal').length;
  for (const [id, c] of Object.entries(pairs[1].destinations)) {
    Object.assign(robots[id], {pair_leg:1,goal:[c.x,c.y,c.yaw]});
  }
  await expect(page.locator('.fleet-robot').nth(0)).toContainText('Travelling to destination rack');
  await expect(page.locator('.fleet-robot').nth(1)).toContainText('Travelling to destination rack');
  expect(commands.filter(c=>c.action==='goal')).toHaveLength(priorGoals);
  await page.getByRole('button',{name:'Stop all',exact:true}).click();
  await expect.poll(() => fleetStops.length).toBe(1);
  expect(commands.filter(c=>c.action==='stop')).toHaveLength(0);
  await expect(page.locator('.fleet-robot').nth(0)).toContainText('Stopped');
  const stoppedGoals = commands.filter(c=>c.action==='goal').length;
  Object.assign(robots.agv1,{state:'succeeded',busy:false,goal:null});
  await page.waitForTimeout(500);
  expect(commands.filter(c=>c.action==='goal')).toHaveLength(stoppedGoals);
  withholdPairAck = true;
  await expect(startBoth).toBeEnabled();
  await startBoth.click();
  await expect.poll(() => pairs.length).toBe(3);
  await expect.poll(() => timedOutPairs.includes(pairs[2].request_id), { timeout: 13000 }).toBe(true);
  await expect(page.locator('.fleet-robot').nth(0)).toContainText('Interrupted');
  await expect(page.locator('.fleet-robot').nth(1)).toContainText('Interrupted');
  withholdPairAck = false;
  // Switching during a held keyboard drive sends zero to the previous robot and disarms.
  await select('agv1');
  await page.keyboard.down('w');
  await expect.poll(() => manual.filter(c=>c.id==='agv1').at(-1)?.x).toBeGreaterThan(0);
  await select('agv2');
  await expect.poll(() => manual.filter(c=>c.id==='agv1').at(-1)?.x).toBe(0);
  await page.keyboard.up('w');
  expect(manual.filter(c=>c.id==='agv2' && c.x!==0)).toHaveLength(0);
  await page.keyboard.down('w');
  await expect.poll(() => manual.filter(c=>c.id==='agv2').at(-1)?.x).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await expect.poll(() => manual.filter(c=>c.id==='agv2').at(-1)?.x).toBe(0);
  await page.keyboard.up('w');
  const modifierCount = manual.filter(c=>c.x!==0).length;
  for (const modifier of ['Meta','Control','Alt']) await page.keyboard.press(`${modifier}+s`);
  await page.waitForTimeout(300);
  expect(manual.filter(c=>c.x!==0)).toHaveLength(modifierCount);
  await page.keyboard.down('w');
  await expect.poll(() => manual.filter(c=>c.id==='agv2').at(-1)?.x).toBeGreaterThan(0);
  safety = true;
  await expect.poll(() => manual.filter(c=>c.id==='agv2').at(-1)?.x).toBe(0);
  safety = false;
  await page.waitForTimeout(300);
  expect(manual.filter(c=>c.id==='agv2').at(-1)?.x).toBe(0);
  await page.keyboard.up('w');
  safety = true;
  await expect(page.getByRole('alert').filter({hasText:'autonomy canceled'})).toBeVisible();
  await page.keyboard.down('s'); // fresh retreat gesture is forwarded, limited in speed
  await expect.poll(() => manual.filter(c=>c.id==='agv2').at(-1)?.x).toBeLessThan(0);
  expect(Math.abs(manual.at(-1)!.x)).toBeLessThanOrEqual(.2);
  await page.keyboard.up('s'); safety = false;
  await page.waitForTimeout(200);
  await page.keyboard.down('w');
  await expect.poll(() => manual.filter(c=>c.id==='agv2').at(-1)?.x).toBeGreaterThan(0);
  pauseFleet = true;
  await expect.poll(() => manual.filter(c=>c.id==='agv2').at(-1)?.x, {timeout:5000}).toBe(0);
  pauseFleet = false;
  await page.waitForTimeout(300);
  expect(manual.filter(c=>c.id==='agv2').at(-1)?.x).toBe(0);
  await page.keyboard.up('w'); await page.keyboard.down('w');
  await expect.poll(() => manual.filter(c=>c.id==='agv2').at(-1)?.x).toBeGreaterThan(0);
  pauseTruth = true;
  await expect.poll(() => manual.filter(c=>c.id==='agv2').at(-1)?.x, {timeout:5000}).toBe(0);
  await page.keyboard.up('w'); pauseTruth = false;
  // Starting and then losing telemetry must cancel the selected robot's autonomy.
  await expect(start).toBeEnabled(); await start.click();
  await expect.poll(() => robots.agv2.busy).toBe(true);
  const cancels = commands.filter(c=>c.action==='cancel').length;
  pauseTruth = true;
  await expect.poll(() => commands.filter(c=>c.action==='cancel').length, {timeout:5000}).toBeGreaterThan(cancels);
  await expect(page.getByRole('button',{name:'Navigate to goal',exact:true})).toBeDisabled();
  pauseTruth = false;
  await expect(page.getByRole('button',{name:'Drive forward',exact:true})).toBeEnabled();
  await page.getByRole('checkbox',{name:'Enable gamepad driving'}).check();
  await expect(page.getByText(/Fleet virtual pad.*Ready — hold RB/)).toBeVisible();
  await page.evaluate(()=>{const p=(window as any).testPad;p.axes=[0,-1];p.buttons[5].pressed=true;});
  await expect.poll(()=>manual.filter(c=>c.id==='agv2').at(-1)?.x).toBeGreaterThan(0);
  const agv1Nonzero = manual.filter(c=>c.id==='agv1' && c.x!==0).length;
  await select('agv1');
  await expect.poll(()=>manual.filter(c=>c.id==='agv2').at(-1)?.x).toBe(0);
  await page.getByRole('checkbox',{name:'Enable gamepad driving'}).check();
  await expect(page.getByText(/Fleet virtual pad.*Release RB/)).toBeVisible();
  await page.waitForTimeout(300);
  expect(manual.filter(c=>c.id==='agv1' && c.x!==0)).toHaveLength(agv1Nonzero);
  await page.evaluate(async () => {
    // Patch the real client transport; Playwright's socket routing replaces native send.
    const {RosBridgeClient} = await import('/src/ros/RosBridgeClient.ts');
    const publish = RosBridgeClient.prototype.publish;
    RosBridgeClient.prototype.publish = function(topic, type, message) {
      if (topic === '/fleet/start_pair' && JSON.parse(message.data).action === 'stop') throw new Error('Injected publish failure');
      return publish.call(this,topic,type,message);
    };
  });
  await page.getByRole('button',{name:'Stop all',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Fleet stop failed: Injected publish failure'})).toBeVisible();
  expect(errors).toEqual([]);
  disconnect();
  await expect(startBoth).toBeDisabled();
  await expect(page.getByText('agv1: Disconnected. agv2: Disconnected.')).toBeVisible();
});

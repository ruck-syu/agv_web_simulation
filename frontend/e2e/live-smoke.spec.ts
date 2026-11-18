import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('live crossing rack jobs finish without collision and Stop all halts both', async ({page}) => {
  test.skip(process.env.AGV_FLEET_SMOKE !== '1', 'Opt-in live motion smoke');
  test.setTimeout(720000);
  let fleet: any;
  const history: any[] = [], collisions: any[] = [];
  const velocity: Record<string,any> = {};
  let minSeparation = Infinity;
  page.on('websocket',socket=>socket.on('framereceived',e=>{
    try {
      const m=JSON.parse(String(e.payload));
      if(m.topic==='/fleet/state') {
        fleet=JSON.parse(m.msg.data);
        if(fleet.separation_m!==null)minSeparation=Math.min(minSeparation,fleet.separation_m);
        const states=Object.values(fleet.robots).map((r:any)=>r.state).join('/');
        if(history.at(-1)?.states!==states)history.push({time:Date.now(),states,robots:fleet.robots});
      }
      if(m.topic?.endsWith('/collision_status')) {const c=JSON.parse(m.msg.data);if(c.collision||c.blocked)collisions.push(c);}
      if(m.topic?.endsWith('/ground_truth')) velocity[m.topic.split('/')[1]]=m.msg.twist.twist;
    } catch {}
  }));
  // Keep real ROS and dashboard controls; avoid software WebGL starving telemetry on CI.
  await page.route(/\/src\/warehouse\/WarehouseCanvas\.tsx(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:'export function WarehouseCanvas(){return null;}'}));
  await page.goto('/');
  const start=page.getByRole('button',{name:'Start rack route',exact:true});
  const stop=page.getByRole('button',{name:'Stop all',exact:true});
  const launch=async(id:string,source:string,dest:string)=>{
    await page.getByRole('radio',{name:id,exact:true}).check();
    await page.getByRole('combobox',{name:'Source rack',exact:true}).selectOption(source);
    await page.getByRole('combobox',{name:'Destination rack',exact:true}).selectOption(dest);
    await expect(start).toBeEnabled(); await start.click();
  };
  try {
    await launch('agv1','B2','D2'); await launch('agv2','A2','C2');
    await expect.poll(()=>fleet && Object.values(fleet.robots).every((r:any)=>r.busy)).toBe(true);
    await stop.click();
    await expect.poll(()=>Object.values(fleet.robots).every((r:any)=>!r.busy && r.state==='canceled')).toBe(true);
    // The UI mounts diagnostics lazily; monitor both authoritative world poses
    // from fleet snapshots rather than relying on selected-only truth subscribers.
    await page.waitForTimeout(1000);
    const stoppedPoses = Object.fromEntries(Object.entries(fleet.robots).map(([id,r]:[string,any])=>[id,[...r.pose]]));
    await page.waitForTimeout(1000);
    for(const id of ['agv1','agv2']) for(let axis=0;axis<3;axis++) expect(Math.abs(fleet.robots[id].pose[axis]-stoppedPoses[id][axis])).toBeLessThan(.01);
    for(const row of await page.locator('.fleet-robot').all()) await expect(row).toContainText('Stopped');
    history.push({states:'STOP ALL VERIFIED',time:Date.now()});
    await launch('agv1','B2','D2'); await launch('agv2','A2','C2');
    await expect.poll(async()=>{
      const rows=await page.locator('.fleet-robot').allTextContents();
      if(rows.some(r=>r.includes('Interrupted')))throw Error(rows.join(' | '));
      return rows.every(r=>r.includes('Route complete'));
    },{timeout:660000,intervals:[1000]}).toBe(true);
    expect(collisions).toEqual([]);
    expect(minSeparation).toBeGreaterThanOrEqual(3);
  } finally {
    writeFileSync('../test_logs/fleet_live_smoke.json',JSON.stringify({history,collisions,minSeparation,fleet,velocity},null,2));
    await stop.click();
  }
});

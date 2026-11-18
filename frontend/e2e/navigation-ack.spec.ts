import { test, expect } from '@playwright/test';

test('queued terminal states cannot interrupt a new rack job and correlated immediate success advances it', async ({page}) => {
  const goals: any[] = [];
  let status: any = {state:'canceled',detail:'Old stop',mode:'manual',busy:false,ready:true,goal:null,request_id:'old'};
  await page.route(/\/src\/warehouse\/WarehouseCanvas\.tsx(?:\?.*)?$/, r=>r.fulfill({contentType:'application/javascript',body:'export function WarehouseCanvas(){return null;}'}));
  await page.routeWebSocket('ws://localhost:9090', socket => {
    socket.onMessage(raw=>{const m=JSON.parse(String(raw)); if(m.op==='publish' && m.topic==='/agv1/agv_web/navigation_command') {const c=JSON.parse(m.msg.data); if(c.action==='goal')goals.push(c);}});
    const send=(topic:string,msg:unknown)=>socket.send(JSON.stringify({op:'publish',topic,msg}));
    const timer=setInterval(()=>{
      const peer={...status,pose:[4.5,1.6,0],waiting_on:[]};
      send('/fleet/state',{data:JSON.stringify({schema_version:1,frame_id:'world',safety_stop:false,separation_m:7.3,robots:{agv1:peer,agv2:peer},reserved_zones:{agv1:[],agv2:[]}})});
      send('/agv1/agv_web/navigation_status',{data:JSON.stringify(status)});
      for(const [topic,frame,child] of [['/agv1/agv_web/ground_truth','world','agv1/ground_truth_base_link'],['/agv1/odom','agv1/odom','agv1/base_link']])
        send(topic,{header:{frame_id:frame},child_frame_id:child,pose:{pose:{position:{x:-11.84,y:2.28},orientation:{x:0,y:0,z:0,w:1}}},twist:{twist:{linear:{x:0},angular:{z:0}}}});
    },50);
    socket.onClose(()=>clearInterval(timer));
  });
  await page.goto('/');
  const start=page.getByRole('button',{name:'Start rack route',exact:true});
  await expect(start).toBeEnabled(); await start.click();
  await expect.poll(()=>goals.length).toBe(1);
  // Old canceled and succeeded packets arrive after sentAt, before acknowledgement.
  await page.waitForTimeout(300);
  await expect(page.locator('.fleet-robot').first()).toContainText('Travelling to source rack');
  status={...status,state:'succeeded'};
  await page.waitForTimeout(300); expect(goals).toHaveLength(1);
  // No busy observation and pose outside the old .1 m / .08 rad shortcut.
  status={...status,request_id:goals[0].request_id};
  await expect.poll(()=>goals.length).toBe(2);
  await page.waitForTimeout(300); expect(goals).toHaveLength(2);
  status={...status,request_id:goals[1].request_id};
  await expect(page.locator('.fleet-robot').first()).toContainText('Route complete');
  await expect(start).toBeEnabled(); await start.click();
  await expect.poll(() => goals.length).toBe(3);
  status={...status,request_id:goals[2].request_id,state:'navigating',mode:'autonomous',busy:true,
    goal:[goals[2].x,goals[2].y,goals[2].yaw]};
  await expect(page.locator('.fleet-robot').first()).toContainText('navigating');
  status={...status,request_id:'replacement'};
  await expect(page.locator('.fleet-robot').first()).toContainText('Interrupted');
  expect(goals).toHaveLength(3);
});

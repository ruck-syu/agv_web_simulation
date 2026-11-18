import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentBlocked, distance, smoothRoute, planFleetRoute } from '../src/navigation/routePlanner.ts';
import { nearestReturn } from '../src/simulation/lidar.ts';
const box = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
test('fleet preview rejects invalid coordinates and continuous out-of-bounds endpoints',()=>{
 for(const p of [{x:31.01,y:0},{x:-31.01,y:0},{x:0,y:19.01},{x:NaN,y:0}]) assert.deepEqual(planFleetRoute(p,{x:8,y:1.6}),[]);
});
test('obstacle proximity ignores absent returns and preserves nearest real surface', () => {
  assert.equal(nearestReturn(null),null);
  assert.equal(nearestReturn({ranges:[null,null]}),null);
  assert.equal(nearestReturn({ranges:[null,3,1.2,8]}),1.2);
});

test('fleet preview uses authoritative rack footprint grid',()=>{
 const path=planFleetRoute({x:-2.8,y:1.6},{x:8,y:1.6});
 assert.ok(path.length>10);
 assert.deepEqual(path[0],{x:-2.8,y:1.6}); assert.deepEqual(path.at(-1),{x:8,y:1.6});
 assert.deepEqual(planFleetRoute({x:-12,y:4.78},{x:8,y:1.6}),[]);
});
test('smooth preview fillet curvature is bounded and unsafe arcs are rejected',()=>{
 const path=smoothRoute([{x:0,y:0},{x:4,y:0},{x:4,y:4}],[]);
 for(let i=1;i<path.length-1;i++){
  const a=path[i-1],b=path[i],c=path[i+1],den=distance(a,b)*distance(b,c)*distance(a,c);
  if(den>1e-10) assert.ok(2*Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/den<=1/.65+1e-6);
 }
 const boxes=[{minX:3.4,maxX:3.8,minY:.1,maxY:.5}];
 const safe=smoothRoute([{x:0,y:0},{x:4,y:0},{x:4,y:4}],boxes);
 safe.slice(1).forEach((p,i)=>assert.equal(segmentBlocked(safe[i],p,boxes),false));
});

test('static fleet preview agrees point-for-point with backend ROS planner fixtures',async()=>{
 const {readFile}=await import('node:fs/promises');
 const cases=JSON.parse(await readFile(new URL('./fixtures/fleetRoutes.json',import.meta.url),'utf8'));
 for(const {start,end,path} of cases){
  const actual=planFleetRoute({x:start[0],y:start[1]},{x:end[0],y:end[1]});
  assert.equal(actual.length,path.length);
  actual.forEach((p,i)=>assert.ok(Math.hypot(p.x-path[i][0],p.y-path[i][1])<1e-8));
 }
});

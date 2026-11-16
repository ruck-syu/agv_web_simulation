import test from 'node:test';
import assert from 'node:assert/strict';
import { planRoute, segmentBlocked, distance } from '../src/navigation/routePlanner.ts';
import { nearestReturn } from '../src/simulation/lidar.ts';
const box = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
test('preview finds direct shortest path in a clear aisle', () => {
  assert.deepEqual(planRoute({x:-5,y:3}, {x:5,y:3}, [box]), [{x:-5,y:3}, {x:5,y:3}]);
});
test('shortest preview detours around a rack without cutting corners', () => {
  const path = planRoute({x:-5,y:0}, {x:5,y:0}, [box]);
  assert.equal(path.length, 4);
  for (let i=1;i<path.length;i++) assert.equal(segmentBlocked(path[i-1],path[i],[box]), false);
  const length = path.slice(1).reduce((sum,p,i)=>sum+distance(path[i],p),0);
  assert.ok(length > 10 && length < 10.4);
});
test('overlapping rack blocks still allow a path around their exterior', () => {
  const boxes = [box, {minX:-1,maxX:1,minY:0,maxY:3}];
  const path = planRoute({x:-5,y:1}, {x:5,y:1}, boxes);
  assert.ok(path.length > 2);
  for (let i=1;i<path.length;i++) assert.equal(segmentBlocked(path[i-1],path[i],boxes),false);
});
test('blocked endpoints, invalid coordinates and sealed aisles have no path', () => {
  assert.deepEqual(planRoute({x:0,y:0},{x:5,y:0},[box]),[]);
  assert.deepEqual(planRoute({x:NaN,y:0},{x:5,y:0},[]),[]);
  assert.deepEqual(planRoute({x:-5,y:0},{x:5,y:0},[{minX:-1,maxX:1,minY:-20,maxY:20}]),[]);
  assert.equal(segmentBlocked({x:-5,y:1},{x:5,y:1},[box]),true);
});
test('obstacle proximity ignores absent returns and preserves nearest real surface', () => {
  assert.equal(nearestReturn(null),null);
  assert.equal(nearestReturn({ranges:[null,null]}),null);
  assert.equal(nearestReturn({ranges:[null,3,1.2,8]}),1.2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNavigation, parsePath } from '../src/navigation/types.ts';
test('navigation status preserves real state and rejects malformed payloads', () => {
  assert.equal(parseNavigation('{}'), null);
  assert.equal(parseNavigation(null), null);
  const status = parseNavigation(JSON.stringify({ state: 'navigating', mode: 'autonomous', detail: 'Following path', busy: true,
    ready: true, distance_remaining: 1.2, goal: [1, 2, 0] }));
  assert.equal(status.distanceRemaining, 1.2);
  assert.equal(status.busy, true);
  assert.equal(status.ready, true);
  assert.deepEqual(status.goal, [1, 2, 0]);
});
test('paths must be in world frame with finite positions and bounded size', () => {
  const path = { header: { frame_id: 'world' }, poses: [{ pose: { position: { x: 1, y: 2 } } }] };
  assert.deepEqual(parsePath(path), [{ x: 1, y: 2 }]);
  assert.equal(parsePath({ ...path, header: { frame_id: 'map' } }), null);
  assert.equal(parsePath({ ...path, poses: [null] }), null);
  assert.equal(parsePath({ ...path, poses: Array(20001).fill(path.poses[0]) }), null);
});

test('decimated paths retain the final waypoint', () => {
  for (const length of [2001, 4000, 20000]) {
    const poses = Array.from({length}, (_, x) => ({pose:{position:{x,y:0}}}));
    assert.deepEqual(parsePath({header:{frame_id:'world'},poses}).at(-1), {x:length-1,y:0});
  }
});
test('terminal navigation status retains request identity after goal clears', () => {
  assert.equal(parseNavigation(JSON.stringify({state:'succeeded',detail:'Reached',mode:'manual',goal:null,request_id:'new-goal'})).requestId,'new-goal');
});

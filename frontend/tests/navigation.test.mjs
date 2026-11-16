import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNavigation, parsePath } from '../src/navigation/types.ts';
test('navigation status preserves real state and rejects malformed payloads', () => {
  assert.equal(parseNavigation('{}'), null);
  assert.equal(parseNavigation(null), null);
  const status = parseNavigation(JSON.stringify({ state: 'navigating', mode: 'autonomous', detail: 'Following path', busy: true,
    server_ready: true, sensors_ready: true, operator_ready: true, distance_remaining: 1.2, goal: [1, 2, 0] }));
  assert.equal(status.distanceRemaining, 1.2);
  assert.equal(status.busy, true);
  assert.deepEqual(status.goal, [1, 2, 0]);
});
test('paths must be in map frame with finite positions and bounded size', () => {
  const path = { header: { frame_id: 'map' }, poses: [{ pose: { position: { x: 1, y: 2 } } }] };
  assert.deepEqual(parsePath(path), [{ x: 1, y: 2 }]);
  assert.equal(parsePath({ ...path, header: { frame_id: 'world' } }), null);
  assert.equal(parsePath({ ...path, poses: [null] }), null);
  assert.equal(parsePath({ ...path, poses: Array(20001).fill(path.poses[0]) }), null);
});

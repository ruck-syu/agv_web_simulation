import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScan } from '../src/simulation/lidar.ts';

const message = {
  header: { frame_id: 'laser_frame' }, angle_min: -Math.PI, angle_increment: Math.PI / 2,
  range_min: 0.05, range_max: 30, ranges: [1, 2, 3, 4],
};
test('retains valid returns and scan angles', () => {
  const scan = parseScan(message);
  assert.deepEqual(scan.ranges, [1, 2, 3, 4]);
  assert.equal(scan.angleMin, -Math.PI);
  assert.equal(scan.angleIncrement, Math.PI / 2);
});
test('ignores rosbridge non-finite encodings and out-of-range returns', () => {
  const scan = parseScan({ ...message, ranges: [null, 'Infinity', '-Infinity', 'NaN', Infinity, NaN, 0, 31, 0.05, 30] });
  assert.deepEqual(scan.ranges, [null, null, null, null, null, null, null, null, 0.05, 30]);
});
test('rejects malformed metadata and unsupported sensor frames', () => {
  for (const patch of [{ header: {} }, { header: null }, { ranges: [] },
    { angle_min: NaN }, { angle_increment: 0 }, { range_min: -1 }, { range_max: Infinity },
    { range_max: 0.01 }, { ranges: Array(10001).fill(1) }]) {
    assert.equal(parseScan({ ...message, ...patch }), null);
  }
});

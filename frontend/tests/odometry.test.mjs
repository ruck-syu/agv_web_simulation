import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOdometryStatus } from '../src/simulation/odometry.ts';
import { parseOdom } from '../src/simulation/telemetry.ts';

const status = { position_error_m: 0.1, heading_error_rad: -0.2, distance_m: 10,
  left_scale: 0.99, right_scale: 1.01, position_std_m: 0.05, heading_std_rad: 0.01 };
test('parses drift with signed heading error', () => {
  const parsed = parseOdometryStatus(JSON.stringify(status));
  assert.equal(parsed.positionError, 0.1);
  assert.equal(parsed.headingError, -0.2);
  assert.equal(parsed.leftScale, 0.99);
});
test('rejects malformed or incomplete drift diagnostics', () => {
  for (const value of [null, '{}', '[]', 'null', 'bad', JSON.stringify({ ...status, position_error_m: -1 }),
    JSON.stringify({ ...status, left_scale: 0 }), JSON.stringify({ ...status, position_std_m: 'NaN' })]) {
    assert.equal(parseOdometryStatus(value), null);
  }
});
const odom = { header: { frame_id: 'odom' }, child_frame_id: 'base_link',
  pose: { pose: { position: { x: 2, y: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } },
  twist: { twist: { linear: { x: 0.5 }, angular: { z: 0.2 } } } };
test('keeps wheel estimates separate from physical ground truth', () => {
  assert.equal(parseOdom(odom, 'world', 'ground_truth_base_link'), null);
  const estimate = parseOdom(odom, 'odom', 'base_link');
  assert.deepEqual(estimate.pose, { x: 2, y: 3, yaw: 0 });
  const truth = { ...odom, header: { frame_id: 'world' }, child_frame_id: 'ground_truth_base_link' };
  assert.equal(parseOdom(truth, 'world', 'ground_truth_base_link').pose.x, 2);
  assert.equal(parseOdom(truth, 'odom', 'base_link'), null);
});
test('rejects invalid poses and normalizes quaternion before extracting yaw', () => {
  for (const patch of [{ position: { x: NaN, y: 0 } },
    { orientation: { x: 0, y: 0, z: 0, w: 0 } }, { position: {} }]) {
    assert.equal(parseOdom({ ...odom, pose: { pose: { ...odom.pose.pose, ...patch } } }, 'odom', 'base_link'), null);
  }
  const scaled = { ...odom, pose: { pose: { ...odom.pose.pose, orientation: { x: 0, y: 0, z: 2, w: 2 } } } };
  assert.ok(Math.abs(parseOdom(scaled, 'odom', 'base_link').pose.yaw - Math.PI / 2) < 1e-10);
});

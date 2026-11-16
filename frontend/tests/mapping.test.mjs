import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMap, parseMapTransform, transformPose, mapPixel } from '../src/mapping/types.ts';
const message = { header: { frame_id: 'map' }, info: { width: 2, height: 2, resolution: 0.1,
  origin: { position: { x: -1, y: -2 }, orientation: { z: 0, w: 1 } } }, data: [-1, 0, 50, 100] };
test('map parser preserves unknown/free/occupied cells and rejects oversized or malformed maps', () => {
  assert.deepEqual(parseMap(message).data, [-1, 0, 50, 100]);
  for (const patch of [{ header: {} }, { data: [0] }, { data: [-2, 0, 0, 0] },
    { info: { ...message.info, width: 100000 } }]) assert.equal(parseMap({ ...message, ...patch }), null);
});
test('TF composition never uses world truth', () => {
  const tf = { transforms: [{ header: { frame_id: 'map' }, child_frame_id: 'odom',
    transform: { translation: { x: 1, y: 2 }, rotation: { z: Math.SQRT1_2, w: Math.SQRT1_2 } } }] };
  const parsed = parseMapTransform(tf);
  const pose = transformPose(parsed, { x: 1, y: 0, yaw: 0 });
  assert.ok(Math.abs(pose.x - 1) < 1e-10);
  assert.ok(Math.abs(pose.y - 3) < 1e-10);
  assert.equal(parseMapTransform({ transforms: [] }), null);
});
test('map pixels respect origin, resolution and ROS row direction, including rotated map origins', () => {
  const map = parseMap(message);
  const pixel = mapPixel(map, -0.9, -1.9);
  assert.ok(Math.abs(pixel.x - 1) < 1e-10 && Math.abs(pixel.y - 1) < 1e-10);
  // Raster is shown in grid-local coordinates: inverse origin rotation must map
  // world +Y to grid +X when the origin is rotated 90 degrees.
  const rotated = { ...map, originYaw: Math.PI / 2 };
  const point = mapPixel(rotated, -1, -1.9);
  assert.ok(Math.abs(point.x - 1) < 1e-10 && Math.abs(point.y - 2) < 1e-10);
});

test('localization rejects queued old TF and malformed timestamps, allowing SLAM future dating', () => {
  const tf = (stamp) => ({transforms:[{header:{frame_id:'map',stamp},child_frame_id:'odom',transform:{translation:{x:1,y:2},rotation:{z:0,w:1}}}]});
  const stamp = ms => ({sec:Math.floor(ms/1000),nanosec:Math.floor(ms%1000)*1000000});
  assert.equal(parseMapTransform(tf(stamp(Date.now()-5000))),null);
  assert.equal(parseMapTransform(tf({sec:'bad',nanosec:0})),null);
  assert.equal(parseMapTransform(tf({sec:Date.now()/1000,nanosec:-1})),null);
  assert.ok(parseMapTransform(tf(stamp(Date.now()))));
  // SLAM Toolbox dates map->odom ahead by its transform timeout (0.5 s).
  assert.ok(parseMapTransform(tf(stamp(Date.now()+500))));
  assert.equal(parseMapTransform(tf(stamp(Date.now()+10000))),null);
});

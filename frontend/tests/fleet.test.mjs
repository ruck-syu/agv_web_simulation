import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFleet, pairIssues, pairRejection, startBoth } from '../src/fleet/types.ts';
const robot = { state: 'waiting', detail: 'Waiting', mode: 'autonomous', ready: true, busy: true, pose: [1,2,0], goal: [3,4,0], waiting_on: ['agv2'] };
const snapshot = () => ({ schema_version: 1, frame_id: 'world', safety_stop: false, separation_m: 7.3, robots: { agv1: {...robot}, agv2: {...robot, goal: null, pose: null} }, reserved_zones: { agv1: [[-6,3]], agv2: [] } });
test('fleet snapshot preserves ownership, wait relationships, null poses and negative tile indices', () => {
  const result = parseFleet(JSON.stringify(snapshot()));
  assert.deepEqual(result.robots.agv1.waiting_on, ['agv2']);
  assert.deepEqual(result.reserved_zones.agv1, [[-6,3]]);
  assert.equal(result.robots.agv2.goal, null);
  assert.equal(result.robots.agv2.pose, null);
  assert.equal(typeof result.receivedAt, 'number');
});
test('malformed or unsupported fleet data is rejected', () => {
  for (const value of [null, '{}', 'bad', JSON.stringify({...snapshot(), frame_id:'map'}), JSON.stringify({...snapshot(), schema_version:2})]) assert.equal(parseFleet(value), null);
  for (const mutate of [s => delete s.robots.agv2, s => s.robots.agv1.pose = [1,2], s => s.reserved_zones.agv1 = [[.5,1]], s => s.robots.agv1.waiting_on = [3], s => s.separation_m = -1]) {
    const s = snapshot(); mutate(s); assert.equal(parseFleet(JSON.stringify(s)), null);
  }
});
test('separation stop remains explicit even when robot readiness is true', () => {
  const result = parseFleet(JSON.stringify({...snapshot(), safety_stop:true, separation_m:2.2}));
  assert.equal(result.safety_stop, true);
  assert.equal(result.robots.agv1.ready, true);
});

test('Start both preflights both robots and publishes two correlated rack routes once', () => {
  const started = [];
  const requests = [];
  const route = (x, issue) => ({
    startIssue: () => issue, sourceGoal: {action:'goal', x, y:4, yaw:0},
    destinationGoal: {action:'goal', x, y:-4, yaw:0},
    beginPair: id => started.push([x, id]),
  });
  const routes = {agv1: route(1, null), agv2: route(2, 'Already running.')};
  assert.deepEqual(pairIssues(routes), ['agv2: Already running.']);
  assert.deepEqual(startBoth(routes, p => requests.push(p), 'blocked'), ['agv2: Already running.']);
  assert.deepEqual(requests, []);
  assert.deepEqual(started, []);
  routes.agv2 = route(6, null);
  for (const separation of [3.1, 3.31]) {
    const issue = ['Robots must be at least 3.32 m apart before starting.'];
    assert.deepEqual(pairIssues(routes, separation), issue);
    assert.deepEqual(startBoth(routes, p => requests.push(p), 'too-close', separation), issue);
  }
  assert.deepEqual(requests, []);
  assert.deepEqual(started, []);
  assert.deepEqual(startBoth(routes, () => { throw Error('Disconnected'); }, 'offline'),
    ['Both routes could not be sent. Disconnected']);
  assert.deepEqual(started, []);
  assert.deepEqual(startBoth(routes, p => requests.push(p), 'pair-1', 3.32), []);
  assert.deepEqual(requests, [{request_id:'pair-1',
    goals:{agv1:routes.agv1.sourceGoal, agv2:routes.agv2.sourceGoal},
    destinations:{agv1:routes.agv1.destinationGoal, agv2:routes.agv2.destinationGoal}}]);
  assert.deepEqual(started, [[1, 'pair-1'], [6, 'pair-1']]);
  assert.deepEqual(pairRejection(JSON.stringify({request_id:'pair-1',issues:{agv2:'Safety stop.'}})),
    {requestId:'pair-1',issues:['agv2: Safety stop.']});
});

test('Start both explains conflicting sources, destinations and mixed rack legs', () => {
  const goal = y => ({action:'goal', x:-12, y, yaw:0});
  const route = (source, destination) => ({
    startIssue: () => null, sourceGoal: goal(source), destinationGoal: goal(destination),
    beginPair: () => assert.fail('A conflicting pair must not start'),
  });
  for (const agv2 of [route(8.52, -12.92), route(16.12, .92), route(.92, -12.92), route(-12.92, 8.52)]) {
    const issues = startBoth({agv1: route(9.88, 2.28), agv2},
      () => assert.fail('A conflicting pair must not publish'), 'blocked');
    assert.equal(issues.length, 2);
    assert.match(issues[0], /^agv1:.*too close/);
    assert.match(issues[1], /^agv2:.*too close/);
  }
});

"""Exercise the actual fleet decision loop without ROS or wall-clock sleeps."""
import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agv_web_bridge.fleet import (MOTION_TRUTH_MAX_AGE, PEER_BRAKING_END,
                                  GridPlanner, braking_speed, peer_speed_limit, route_zones)
from agv_web_bridge.fleet_coordinator import FleetCoordinator
from agv_web_bridge.motion_limits import (FLEET_COMMAND_LIFESPAN, FLEET_COMMAND_TIMEOUT,
                                          MAX_LINEAR_SPEED, SIM_LINEAR_ACCELERATION)


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.time=100.
        self.core=FleetCoordinator(GridPlanner([],bounds=(-12,12,-12,12)),lambda:self.time)
        self.outputs={}
        self.core.publish_velocity=lambda rid,v:self.outputs.update({rid:v})
        self.core.robots["agv1"]["pose"]=(-8.,0.,0.)
        self.core.robots["agv2"]["pose"]=(8.,0.,0.)
        self.refresh()

    def refresh(self):
        for r in self.core.robots.values():
            r["truth_time"]=self.time
            c=r["control"]
            c.odom_time=c.scan_time=c.heartbeat_time=self.time

    def goal(self,rid,x,y=0):
        self.core.command(rid,dict(action="goal",x=x,y=y,yaw=0))

    def tick(self,dt=0):
        self.time+=dt
        self.refresh()
        return self.core.tick()

    def test_request_id_survives_terminal_status_and_changes_with_next_goal(self):
        self.core.command("agv1",dict(action="goal",x=-8,y=0,yaw=0,request_id="first"))
        self.core.stop("agv1","succeeded","Goal reached")
        status=self.tick()["robots"]["agv1"]
        self.assertIsNone(status["goal"])
        self.assertEqual(status["request_id"],"first")
        self.core.command("agv1",dict(action="goal",x=-5,y=0,yaw=0,request_id="second"))
        self.assertEqual(self.tick()["robots"]["agv1"]["request_id"],"second")
        self.goal("agv1",-4)
        self.assertIsNone(self.tick()["robots"]["agv1"]["request_id"])

    def test_stop_retreat_hysteresis_and_new_goal_after_recovery(self):
        a,b=self.core.robots.values()
        a["pose"]=(0.,0.,0.); b["pose"]=(2.2,0.,0.)
        self.core.manual("agv1",(.8,0))
        self.assertTrue(self.tick()["safety_stop"])
        self.assertEqual(self.outputs["agv1"],(0.,0.))
        self.core.manual("agv1",(-.8,0))
        self.assertTrue(self.tick()["safety_stop"])
        self.assertEqual(self.outputs["agv1"],(-.2,0))
        b["pose"]=(3.1,0.,0.)
        self.assertTrue(self.tick()["safety_stop"])
        b["pose"]=(3.31,0.,0.)
        self.assertFalse(self.tick()["safety_stop"])
        b["pose"]=(3.33,0.,0.)
        self.goal("agv1",-5)
        self.tick()
        self.assertEqual(a["state"],"navigating")

    def test_cruise_braking_distance(self):
        self.assertGreater(braking_speed(.56), .99)
        self.assertEqual(braking_speed(0.), 0.)

    def test_separation_latch_and_stale_peer_fail_closed(self):
        a, b = self.core.robots.values()
        a['pose'] = (0., 0., 0.)
        b['pose'] = (3., 0., 0.)
        self.assertFalse(self.tick()['safety_stop'])
        b['pose'] = (2.99, 0., 0.)
        self.assertTrue(self.tick()['safety_stop'])
        b['pose'] = (3.3, 0., 0.)
        self.assertFalse(self.tick()['safety_stop'])
        b['truth_time'] -= 2.
        self.assertTrue(self.core.tick()['safety_stop'])

    def test_pair_is_admitted_atomically_with_matching_request_ids(self):
        command = dict(request_id="pair", goals={
            "agv1": dict(action="goal", x=-3., y=0., yaw=0.),
            "agv2": dict(action="goal", x=3., y=0., yaw=0.),
        })
        a, b = self.core.robots.values()
        b["control"].scan_time -= 2.
        rejected = self.core.start_pair(command)
        self.assertEqual(rejected["request_id"], "pair")
        self.assertEqual(set(rejected["issues"]), {"agv2"})
        self.assertIsNone(a["goal"])
        self.assertIsNone(a["request_id"])
        self.assertIsNone(b["goal"])
        self.assertEqual(self.outputs, {})

        self.refresh()
        self.assertIsNone(self.core.start_pair(command))
        self.assertEqual(a["requested"], b["requested"])
        self.assertEqual(a["request_id"], b["request_id"])
        rejected = self.core.start_pair({**command, "request_id": "duplicate"})
        self.assertEqual(rejected["issues"], {"agv1": "Already running.", "agv2": "Already running."})
        self.assertEqual(a["request_id"], "pair")
        self.core.cancel_pair("duplicate")
        self.assertTrue(all(r["goal"] for r in (a, b)))
        self.core.cancel_pair("pair")
        self.assertTrue(all(r["state"] == "canceled" and r["goal"] is None for r in (a, b)))

    def rack_pair(self):
        def goal(x, y=0.):
            return dict(action="goal", x=x, y=y, yaw=0.)
        return dict(request_id="rack-pair", goals={"agv1": goal(-8.), "agv2": goal(8.)},
                    destinations={"agv1": goal(-7.), "agv2": goal(7.)})

    def test_pair_rejects_conflicting_source_destination_and_mixed_legs(self):
        for agv1_leg, agv2_leg in (("goals", "goals"), ("destinations", "destinations"),
                                   ("goals", "destinations"), ("destinations", "goals")):
            with self.subTest(legs=(agv1_leg, agv2_leg)):
                self.setUp()
                request = self.rack_pair()
                request[agv1_leg]["agv1"].update(x=-10., y=0.)
                request[agv2_leg]["agv2"].update(x=-10., y=1.36)
                result = self.core.start_pair(request)
                self.assertTrue(all(r["goal"] is None for r in self.core.robots.values()))
                self.assertEqual(set(result["issues"]), {"agv1", "agv2"})

    def test_pair_cancel_stops_both_during_second_legs(self):
        self.assertIsNone(self.core.start_pair(self.rack_pair()))
        state = self.tick()["robots"]
        self.assertEqual([r["goal"][0] for r in state.values()], [-7., 7.])
        self.assertTrue(all(r["request_id"] == "rack-pair" for r in state.values()))
        self.core.cancel_pair("rack-pair")
        self.assertTrue(all(r["state"] == "canceled" and r["goal"] is None
                            for r in self.core.robots.values()))

    def test_pair_leg_failure_aborts_peer_before_destination(self):
        request = self.rack_pair()
        request["goals"]["agv2"]["x"] = 6.
        self.assertIsNone(self.core.start_pair(request))
        self.core.robots["agv1"]["control"].heartbeat_time -= 3.
        state = self.core.tick()["robots"]
        self.assertEqual(state["agv1"]["state"], "safety_stop")
        self.assertEqual(state["agv2"]["state"], "canceled")
        self.assertFalse(state["agv2"]["busy"])
        self.assertEqual(self.outputs["agv2"], (0., 0.))

    def test_global_stop_on_pair_channel_cancels_all_queued_autonomy(self):
        self.goal("agv1", -4.)
        self.goal("agv2", 4.)
        self.core.start_pair({"action": "stop"})
        self.assertTrue(all(r["state"] == "canceled" and r["goal"] is None
                            for r in self.core.robots.values()))
        self.assertIsNone(self.core.start_pair(self.rack_pair()))
        self.core.start_pair({"action": "stop"})
        self.assertFalse(any(r["busy"] for r in self.tick()["robots"].values()))

    def test_pair_leg_timeout_aborts_peer_already_on_destination(self):
        request = self.rack_pair()
        request["goals"]["agv1"]["x"] = -6.
        self.assertIsNone(self.core.start_pair(request))
        self.tick()
        a, b = self.core.robots.values()
        self.assertEqual(b["pair_leg"], 1)
        a["started"] -= 181.
        self.tick(.1)
        self.assertEqual(a["state"], "failed")
        self.assertEqual(b["state"], "canceled")
        self.assertEqual(self.outputs["agv2"], (0., 0.))

    def test_pair_rejects_measured_speed_over_near_peer_cap(self):
        self.core.robots["agv1"].update(pose=(0., 0., 0.), velocity=(1., 0.))
        self.core.robots["agv2"].update(pose=(3.5, 0., 0.), velocity=(-1., 0.))
        result = self.core.start_pair(self.rack_pair())
        self.assertEqual(set(result["issues"]), {"agv1", "agv2"})
        self.assertTrue(all("speed" in issue for issue in result["issues"].values()))
        for r in self.core.robots.values():
            r["velocity"] = (0., 0.)
        self.assertIsNone(self.core.start_pair(self.rack_pair()))

    def test_pair_requires_live_peer_clearance(self):
        a, b = self.core.robots.values()
        a['pose'] = (0., 0., 0.)
        for separation in (3.1, 3.31):
            with self.subTest(separation=separation):
                b['pose'] = (separation, 0., 0.)
                self.assertFalse(self.tick()['safety_stop'])
                result = self.core.start_pair(self.rack_pair())
                self.assertIsNotNone(result)
                self.assertEqual(result['request_id'], 'rack-pair')
                self.assertEqual(set(result['issues']), {'agv1', 'agv2'})
                self.assertTrue(all('3.32 m' in issue for issue in result['issues'].values()))
                self.assertFalse(any(r['goal'] for r in (a, b)))
        b['pose'] = (3.32, 0., 0.)
        self.assertIsNone(self.core.start_pair(self.rack_pair()))

    def test_goal_can_move_away_when_only_rounded_start_is_inside_peer_clearance(self):
        a, b = self.core.robots.values()
        a['pose'], b['pose'] = (3.32, 0., 0.), (0., 0., 0.)
        self.goal('agv1', 6.)
        self.tick()
        self.assertEqual(a['state'], 'navigating')
        self.assertGreater(self.outputs['agv1'][0], 0.)
        self.assertTrue(all(self.core.planner.clear(p, q, [b['pose']]) for p, q in zip(a['path'], a['path'][1:])))

    def test_single_goal_refused_while_active_peer_is_too_close(self):
        self.goal('agv2', 10.)
        self.tick()
        self.core.robots['agv2'].update(pose=(-4.9, 0., 0.), velocity=(.4, 0.))
        self.core.command('agv1', dict(action='goal', x=-10., y=0., yaw=0., request_id='close'))
        a, b = self.core.robots.values()
        self.assertEqual((a['state'], a['request_id']), ('failed', 'close'))
        self.assertIn('3.32 m', a['detail'])
        self.assertIsNone(a['goal'])
        self.assertEqual(b['goal'], (10., 0., 0.))

    def test_invalid_goals_fail_immediately_with_new_request_id(self):
        self.core.planner = GridPlanner([])
        for x, y, yaw, detail in ((40., 0., 0., 'bounds'), (31.001, 0., 0., 'bounds'),
                                  (0., -19.001, 0., 'bounds'), (0., 0., None, 'finite')):
            with self.subTest(x=x, y=y, yaw=yaw):
                self.goal('agv1', -4.)
                self.tick()
                command = dict(action='goal', x=x, y=y, yaw=yaw, request_id='rejected')
                self.core.command('agv1', command)
                a = self.core.robots['agv1']
                self.assertEqual((a['state'], a['request_id']), ('failed', 'rejected'))
                self.assertIn(detail, a['detail'])
                self.assertIsNone(a['goal'])
                self.assertEqual(self.outputs['agv1'], (0., 0.))
        self.goal('agv1', -31., 19.)
        self.assertEqual(self.core.robots['agv1']['goal'], (-31., 19., 0.))

    def test_pair_rejects_out_of_bounds_destination_atomically(self):
        self.core.planner = GridPlanner([])
        request = self.rack_pair()
        request['destinations']['agv2']['x'] = 40.
        result = self.core.start_pair(request)
        self.assertEqual(result['request_id'], request['request_id'])
        self.assertIn('Destination goal is outside world bounds', result['issues']['agv2'])
        self.assertFalse(any(r['goal'] for r in self.core.robots.values()))

    def test_braking_for_corner_returns_zero_when_target_cannot_fit_latency(self):
        self.assertEqual(braking_speed(.05, .55), 0.)
        self.assertEqual(braking_speed(.14 * .55, .55), 0.)
        v = braking_speed(.25, .55)
        self.assertAlmostEqual(.14 * v + .04 * .55 + (v**2 - .55**2) / (2 * 1.2), .25)

    def test_latch_braking_preserves_margin_after_delay_and_watchdog(self):
        close_speed = peer_speed_limit(3.)
        # Allow 120 ms of pose age, a 100 ms control tick, 100 ms of
        # in-flight transport, a 500 ms stall and a 20 ms physics step.
        remaining = 3. - 2 * (.84 * close_speed + close_speed**2 / (2 * 1.2))
        self.assertGreaterEqual(remaining, math.hypot(1.55, 1.06) + .15)

    def test_braking_band_budget_covers_full_speed_and_stalled_coordinator(self):
        decision_delay = MOTION_TRUTH_MAX_AGE + .10 + FLEET_COMMAND_LIFESPAN + .02
        stall_delay = decision_delay + FLEET_COMMAND_TIMEOUT
        cruise = MAX_LINEAR_SPEED
        close_speed = peer_speed_limit(3.)
        settling = 2 * cruise * decision_delay + (cruise**2 - close_speed**2) / SIM_LINEAR_ACCELERATION
        self.assertGreater(PEER_BRAKING_END - settling, 3.)
        for remaining in (3. - 2 * close_speed * stall_delay - close_speed**2 / SIM_LINEAR_ACCELERATION,
                          PEER_BRAKING_END - 2 * cruise * stall_delay - cruise**2 / SIM_LINEAR_ACCELERATION):
            self.assertGreaterEqual(remaining, math.hypot(1.55, 1.06) + .4)

    def test_old_truth_brakes_before_readiness_expires(self):
        self.goal("agv1", -4)
        self.tick()
        self.assertGreater(self.outputs["agv1"][0], 0.)
        self.time += .15
        state = self.core.tick()
        self.assertEqual(self.outputs["agv1"], (0., 0.))
        self.assertTrue(state["robots"]["agv1"]["busy"])

    def test_manual_can_leave_existing_corridor_clearance(self):
        a=self.core.robots["agv1"]
        a["pose"]=(0,2.5,math.pi/2)
        self.core.reservations.acquire("agv2",route_zones([(x*.25,0) for x in range(-10,11)]))
        self.core.manual("agv1",(.4,0)); self.tick()
        self.assertEqual(self.outputs["agv1"],(.4,0))
        self.core.manual("agv1",(-.4,0)); self.tick()
        self.assertEqual(self.outputs["agv1"],(0.,0.))

    def test_distant_held_route_does_not_block_initial_progress(self):
        held=route_zones([(0,y*.25) for y in range(-4,5)])
        self.core.reservations.acquire("agv2",held)
        self.goal("agv1",4)
        self.tick()
        a=self.core.robots["agv1"]
        self.assertEqual(a["state"],"navigating")
        self.assertGreater(self.outputs["agv1"][0],0)
        self.assertFalse(self.core.reservations.routes["agv1"] & held)

    def test_endpoint_forbidden_exemption_does_not_bypass_acquisition(self):
        a=self.core.robots["agv1"]
        held=route_zones([a["pose"][:2]])
        self.core.reservations.acquire("agv2",held)
        self.goal("agv1",0); self.tick()
        self.assertEqual(a["state"],"waiting")
        self.assertNotIn("agv1",self.core.reservations.routes)

    def test_rolling_holder_releases_tiles_behind(self):
        a=self.core.robots["agv1"]
        self.goal("agv1",4); self.tick()
        original=set(self.core.reservations.routes["agv1"])
        a["pose"]=(-3.,0.,0.)
        self.tick(.1)
        self.assertFalse(original & self.core.reservations.routes["agv1"])
        self.assertEqual(a["state"],"navigating")

    def test_absolute_request_deadline_bounds_wait(self):
        self.goal("agv1",0)
        a=self.core.robots["agv1"]
        a["wait_since"]=self.time+181
        self.tick(181)
        self.assertEqual(a["state"],"failed")

    def test_no_route_wait_and_no_progress_have_separate_clocks(self):
        a=self.core.robots["agv1"]
        self.goal("agv1",0); self.tick()
        a["started"]-=40; a["requested"]-=40; a["progress_time"]-=9
        self.tick()
        self.assertEqual(a["state"],"waiting")
        self.assertEqual(a["wait_since"],self.time)
        self.core.planner.blocked.add(self.core.planner.cell(a["goal"]))
        self.tick(2)
        self.assertEqual(a["state"],"waiting")
        self.tick(29)
        self.assertEqual(a["state"],"failed")

    def test_fifo_does_not_block_distant_new_request_during_backoff(self):
        self.goal("agv1",0)
        a,b=self.core.robots.values()
        a["retry"]=self.time+2
        self.time+=.1; self.refresh()
        self.goal("agv2",0); self.tick()
        self.assertEqual(b["state"],"navigating")
        self.assertEqual(b["waiting_on"],[])
        self.assertIn("agv2",self.core.reservations.routes)
        self.tick(2)
        self.assertEqual(a["state"],"navigating")

    def test_parked_goal_failure_is_immediate_and_explicit(self):
        self.goal("agv1",7)
        state=self.tick()
        self.assertEqual(state["robots"]["agv1"]["state"],"failed")
        self.assertIn("parked agv2",state["robots"]["agv1"]["detail"])

    def test_stale_truth_cannot_use_retreat(self):
        self.core.manual("agv1",(-.5,0))
        self.core.robots["agv2"]["truth_time"]-=2
        self.core.tick()
        self.assertEqual(self.outputs["agv1"],(0.,0.))

    def test_holder_deadline_releases_rolling_reservation(self):
        self.goal("agv1",0); self.tick()
        self.assertIn("agv1",self.core.reservations.routes)
        self.core.robots["agv1"]["started"]=self.time-181
        self.tick()
        self.assertEqual(self.core.robots["agv1"]["state"],"failed")
        self.assertNotIn("agv1",self.core.reservations.routes)

    def test_turning_manual_arc_cannot_curve_towards_peer(self):
        a,b=self.core.robots.values()
        a["pose"]=(0.,0.,math.pi/2); b["pose"]=(2.2,0.,0.)
        self.core.manual("agv1",(.2,-.3))
        self.tick()
        self.assertEqual(self.outputs["agv1"],(0.,0.))
        self.core.manual("agv1",(.2,.3))
        self.tick()
        self.assertEqual(self.outputs["agv1"],(.2,.3))

    def test_peer_occluding_only_aisle_is_a_holder_wait(self):
        self.core.planner=GridPlanner([],bounds=(-12,12,-1,1))
        a,b=self.core.robots.values()
        b["pose"]=(0.,0.,0.)
        self.goal("agv2",8)
        self.core.reservations.acquire("agv2",route_zones([(0,0),(8,0)]))
        b.update(state="navigating",path=[(8,0)],progress_pose=b["pose"],progress_time=self.time)
        self.goal("agv1",5); self.tick()
        self.assertEqual(a["waiting_on"],["agv2"])
        for _ in range(45):
            b["pose"]=(0.,0.,b["pose"][2]+.2)
            self.tick(1)
        self.assertEqual(a["state"],"failed")


    def test_zero_manual_twist_does_not_cancel_autonomy(self):
        self.goal("agv1",-4)
        self.tick(.1)
        self.core.manual("agv1",(0.,0.))
        r=self.core.robots["agv1"]
        self.assertIsNotNone(r["goal"])
        self.assertNotEqual(r["state"],"manual")
        self.core.manual("agv1",(.3,0.))
        self.assertEqual(r["state"],"manual")
        self.assertIsNone(r["goal"])
        self.core.manual("agv1",(0.,0.))
        self.assertEqual(r["control"].manual,(0.,0.))

    def test_identical_busy_goal_keeps_timers_and_adopts_request_id(self):
        self.core.command("agv1",dict(action="goal",x=-4,y=0,yaw=0,request_id="a"))
        self.tick(.5)
        r=self.core.robots["agv1"]
        requested,started=r["requested"],r["started"]
        self.core.command("agv1",dict(action="goal",x=-4,y=0,yaw=0,request_id="b"))
        self.assertEqual((r["requested"],r["started"]),(requested,started))
        self.assertEqual(r["request_id"],"b")
        self.core.command("agv1",dict(action="goal",x=-5,y=0,yaw=0))
        self.assertGreater(r["requested"],requested-1e-9)
        self.assertEqual(r["goal"],(-5.,0.,0.))

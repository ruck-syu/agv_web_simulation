"""Review regressions: exercise the public pure-Python decision loop."""
import math
import unittest
from unittest.mock import patch
import test_fleet_coordinator as fixtures
from agv_web_bridge.fleet import GridPlanner, lookahead

class ReviewRegressions(unittest.TestCase):
    setUp=fixtures.CoordinatorTests.setUp
    refresh=fixtures.CoordinatorTests.refresh
    goal=fixtures.CoordinatorTests.goal
    tick=fixtures.CoordinatorTests.tick
    def test_blocked_chord_still_pivots(self):
        self.goal('agv1',-4)
        self.tick()
        r=self.core.robots['agv1']; r['pose']=(-8,0,math.pi)
        clear=self.core.planner.clear
        self.core.planner.clear=lambda a,b,*args: False if math.dist(a[:2],b[:2])>.3 else clear(a,b,*args)
        self.tick(.1)
        self.assertGreater(abs(self.outputs['agv1'][1]),0)

    def test_midroute_wait_starts_now(self):
        self.goal('agv1',0); self.tick()
        self.time+=35; self.refresh()
        self.core.planner.route=lambda *a,**k: []
        self.core.plan('agv1',self.time)
        self.assertEqual(self.core.robots['agv1']['wait_since'],self.time)

    def test_success_clears_old_escape(self):
        self.goal('agv1',0); self.tick()
        r=self.core.robots['agv1']; r['yield_target']=(-6,4)
        self.core.plan('agv1',self.time)
        self.assertNotIn('yield_target',r)

    def test_watchdog_clears_escape(self):
        self.goal('agv1',0); self.tick()
        r=self.core.robots['agv1']; r.update(yield_target=(-6,4),progress_time=self.time-9)
        self.tick()
        self.assertNotIn('yield_target',r)

    def test_rotation_is_not_progress(self):
        self.goal('agv1',0); self.tick()
        r=self.core.robots['agv1']; old=r['progress_time']
        r['pose']=(-8,0,.3); self.tick(1)
        self.assertEqual(r['progress_time'],old)

    def test_conflict_bypasses_rate_limit(self):
        self.goal('agv1',4); self.tick()
        r=self.core.robots['agv1']; n=r['replans']
        self.core.robots['agv2']['pose']=(-3,0,0)
        self.tick(.1)
        self.assertGreater(r.get('replans',0),n)

    def test_rejected_request_has_new_id(self):
        r=self.core.robots['agv1']; r['request_id']='old'; r['truth_time']-=2
        self.core.command('agv1',dict(action='goal',x=0,y=0,yaw=0,request_id='new'))
        self.assertEqual(r['request_id'],'new')

    def test_clearance_is_subdivision_invariant(self):
        p=GridPlanner([]); p.blocked={(0,0)}
        # Tiny corner intersection falls between fixed distance samples.
        a=(-.25,.001); b=(.05,-.299)
        self.assertFalse(p.clear(a,b))

    def test_emitted_seed5_route_is_clear(self):
        import fleet_fuzz
        s=fleet_fuzz.scenario(5,1)
        for r in s['core'].robots.values():
            self.assertTrue(all(s['core'].planner.clear(a,b) for a,b in zip(r['path'],r['path'][1:])))

    def test_sensor_staleness_blocks_retreat_with_fresh_truth(self):
        self.core.manual('agv1',(-.5,0))
        self.core.robots['agv1']['control'].scan_time-=2
        self.core.tick()
        self.assertEqual(self.outputs['agv1'],(0.,0.))

    def test_optimizer_cannot_replace_valid_plan_with_wait(self):
        self.goal('agv1',0); self.tick()
        r=self.core.robots['agv1']; original=r['path'][:]
        self.core.planner.route=lambda *a,**k: []
        self.core.plan('agv1',self.time,optimize=True)
        self.assertEqual(r['state'],'navigating')
        self.assertEqual(r['path'],original)

    def test_arc_bulge_is_checked(self):
        from agv_web_bridge.fleet import track, projected_motion
        p=GridPlanner([])
        # A blocked cell below a clear diagonal chord intersects the pursuit arc.
        pose=(-.09090421420747671,.018888071532852074,0.)
        path=[(.2548252435688845,.3800959646161335)]
        p.blocked={(1,0)}
        self.assertTrue(p.clear(pose,path[0]))
        command=track(p,pose,path)
        arc=[pose[:2]]+list(projected_motion(pose,command))
        self.assertTrue(all(p.clear(a,b) for a,b in zip(arc,arc[1:])))

    def test_holding_point_is_in_bay_and_has_return_route(self):
        p=GridPlanner([],bounds=(-18,18,-1,8))
        p.blocked={(x,y) for x in range(-72,73) for y in range(-4,33)
                   if not (abs(y)<=3 or (6<=x<=27 and 3<=y<=29))}
        self.core.planner=p
        a,b=self.core.robots.values()
        a['pose']=(-12,0,0); b['pose']=(12,0,math.pi)
        self.goal('agv1',12); self.goal('agv2',-12)
        self.core.plan('agv1',self.time)
        self.core.plan('agv2',self.time)
        self.assertIn('yield_target',b)
        x,y=b['yield_target']
        self.assertTrue(1.5<=x<=6.75 and y>=3.8,(x,y))
        self.assertTrue(p.route(b['yield_target'],b['goal'],[a['goal']]))

    def test_parked_peer_severing_corridor_fails_promptly(self):
        self.core.planner=GridPlanner([],bounds=(-12,12,-.75,.75))
        self.core.robots['agv2']['pose']=(0,0,0)
        self.goal('agv1',6); self.tick()
        r=self.core.robots['agv1']
        self.assertEqual(r['state'],'failed')
        self.assertIn('parked agv2',r['detail'])

    def test_prediction_keeps_dense_peer_samples(self):
        from agv_web_bridge.fleet import sample_path
        self.goal('agv1',0); self.time+=.1; self.goal('agv2',-4)
        a,b=self.core.robots.values()
        a['path']=sample_path([(-8,0),(-6,0)])
        original=self.core.planner.route; occupancies=[]
        def route(start,goal,peers=(),*args,**kwargs):
            occupancies.append(list(peers))
            return original(start,goal,peers,*args,**kwargs)
        self.core.planner.route=route
        self.core.plan('agv2',self.time)
        dense=[ps[1:] for ps in occupancies if len(ps)>2]
        self.assertTrue(dense)
        self.assertLessEqual(max(math.dist(x,y) for ps in dense for x,y in zip(ps,ps[1:])),.1)

    def test_blocked_carrot_shrinks_to_clear_sample(self):
        self.goal('agv1',-4); self.tick()
        clear=self.core.planner.clear
        self.core.planner.clear=lambda a,b,*args: math.dist(a[:2],b[:2])<=.3 and clear(a,b,*args)
        self.tick(.1)
        self.assertGreater(self.outputs['agv1'][0],0)

    def test_seeded_review_failures_complete(self):
        import fleet_fuzz
        for seed in (5,11,12,13,44,134):
            with self.subTest(seed=seed):
                result=fleet_fuzz.scenario(seed)
                self.assertTrue(all(r['state']=='succeeded' for r in result['core'].robots.values()),result['final'])

    def test_near_sample_does_not_suppress_pivot_fallback(self):
        from agv_web_bridge.fleet import track
        p=GridPlanner([])
        pose=(-.09090421420747671,.018888071532852074,0.)
        p.blocked={(1,0)}
        command=track(p,pose,[(.2548252435688845,.3800959646161335)])
        self.assertGreater(abs(command[1]),0)

    def test_metrics_distinguish_retreat_and_interpolate_separation(self):
        import importlib.util
        from pathlib import Path
        spec=importlib.util.spec_from_file_location('smoke_metrics',Path(__file__).resolve().parents[4]/'scripts/summarize_fleet_smoke.py')
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        result=dict(start_poses={'a':(-1,0,0),'b':(1,0,0)},goals={'a':(-5,0),'b':(5,0)},timeline=[dict(t=1,robots={'a':dict(pose=(1,0,0),yielding=True),'b':dict(pose=(-1,0,0))})])
        module.summarize(result)
        self.assertEqual(result['min_separation_m'],0.)
        self.assertEqual(result['both_progressing_to_own_goals_s'],0.)
        self.assertEqual(result['yielding_or_retreating_s'],1.)

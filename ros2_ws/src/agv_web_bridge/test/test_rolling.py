import math
import sys
import time
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from agv_web_bridge.fleet import GridPlanner, fillet, track, lookahead, route_zones
import test_fleet_coordinator as fixtures

class SmoothTests(unittest.TestCase):
    def test_shortcuts_l_and_zigzag(self):
        planner=GridPlanner([])
        for goal in ((5,5),(7,3),(-3,6)):
            raw=planner.route((0,0),goal,smooth=False)
            refined=planner.route((0,0),goal)
            length=lambda p:sum(math.dist(a,b) for a,b in zip(p,p[1:]))
            self.assertLess(length(refined),length(raw)-.5)
            self.assertAlmostEqual(length(refined),math.dist((0,0),goal),places=6)
    def test_inflated_obstacles_never_cut(self):
        p=GridPlanner([])
        p.blocked={(x,y) for x in range(-4,5) for y in range(-8,9)}
        path=p.route((-4,0),(4,0))
        self.assertTrue(path)
        self.assertTrue(all(p.clear(a,b) for a,b in zip(path,path[1:])))
    def test_fillet_curvature_and_clearance(self):
        p=GridPlanner([])
        path=fillet([(0,0),(4,0),(4,4)],p.clear)
        curvatures=[]
        for a,b,c in zip(path,path[1:],path[2:]):
            ab,bc,ac=math.dist(a,b),math.dist(b,c),math.dist(a,c)
            if ab*bc*ac>1e-10:
                curvatures.append(2*abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/(ab*bc*ac))
        self.assertLessEqual(max(curvatures),1/.65+1e-6)
        self.assertTrue(all(p.clear(a,b) for a,b in zip(path,path[1:])))
    def test_gentle_corner_translates(self):
        v,w=track(GridPlanner([]),(0,0,0),[(1,.3)])
        self.assertGreater(v,.1); self.assertGreater(w,0)
    def test_lookahead_releases_behind_and_does_not_lock_goal(self):
        a=route_zones(lookahead((0,0,0),[(10,0)]))
        b=route_zones(lookahead((5,0,0),[(10,0)]))
        self.assertFalse(a&b)

class RollingTests(unittest.TestCase):
    setUp=fixtures.CoordinatorTests.setUp
    refresh=fixtures.CoordinatorTests.refresh
    goal=fixtures.CoordinatorTests.goal
    tick=fixtures.CoordinatorTests.tick
    def test_overlap_both_advance_before_conflict(self):
        self.goal('agv1',4); self.goal('agv2',-4)
        self.tick()
        self.assertGreater(self.outputs['agv1'][0],0)
        # agv2 faces away and must initially rotate.
        self.core.robots['agv2']['pose']=(8,0,math.pi)
        self.tick(.1)
        self.assertGreater(self.outputs['agv2'][0],0)
    def test_peer_obstacle_triggers_replan(self):
        self.goal('agv1',4); self.tick()
        r=self.core.robots['agv1']; n=r['replans']
        self.core.robots['agv2']['pose']=(-3,0,0)
        self.tick(2.1)
        self.assertGreater(r.get('replans',0),n)
        self.assertTrue(any(abs(y)>1 for x,y in r['path']))
    def test_departing_peer_shortens_committed_detour(self):
        self.core.robots['agv2']['pose']=(0,0,0)
        self.goal('agv1',4); self.tick()
        r=self.core.robots['agv1']; n=r['replans']
        old=sum(math.dist(a,b) for a,b in zip(r['path'],r['path'][1:]))
        self.core.robots['agv2']['pose']=(8,8,0)
        self.tick(2.1)
        self.assertGreater(r['replans'],n)
        self.assertLess(sum(math.dist(a,b) for a,b in zip(r['path'],r['path'][1:])),old-.75)

    def test_single_aisle_with_holding_bays_resolves(self):
        from types import SimpleNamespace
        walls=[SimpleNamespace(cx=0,cy=y,hx=4,hy=4,yaw=0,shape='box',min_z=0,max_z=2) for y in (-6,6)]
        self.core.planner=GridPlanner(walls,bounds=(-12,12,-12,12))
        self.simulate_headon(8)

    def test_headon_detour_completes_without_safety_stop(self):
        self.simulate_headon(4)

    def test_headon_yield_keeps_tick_under_watchdog_budget(self):
        self.core.planner = GridPlanner([])
        worst, yielded = self.simulate_headon(8.)
        self.assertTrue(yielded)
        self.assertLess(worst, .100, f'Worst planning tick: {worst * 1000:.1f} ms')

    def simulate_headon(self, destination):
        self.core.robots['agv2']['pose']=(8,0,math.pi)
        self.goal('agv1',destination); self.goal('agv2',-destination)
        minimum=100
        worst=0.
        yielded=False
        for _ in range(1700):
            started=time.perf_counter()
            state=self.tick(.1)
            worst=max(worst,time.perf_counter()-started)
            yielded |= state['robots']['agv2']['yielding']
            self.assertFalse(state['safety_stop'])
            minimum=min(minimum,state['separation_m'])
            for rid,r in self.core.robots.items():
                v,w=self.outputs[rid]; x,y,t=r['pose']
                r['pose']=(x+v*math.cos(t)*.1,y+v*math.sin(t)*.1,t+w*.1)
            if all(r['state']=='succeeded' for r in self.core.robots.values()): break
        self.assertTrue(all(r['state']=='succeeded' for r in self.core.robots.values()),[(r['state'],r['detail'],r['pose']) for r in self.core.robots.values()])
        self.assertGreaterEqual(minimum,3.)
        return worst, yielded

import math
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from agv_web_bridge.fleet import GridPlanner, Reservations, route_zones, track, request_expired


class FleetTests(unittest.TestCase):
    def test_atomic_opposite_aisle_requests(self):
        locks=Reservations(); route=route_zones([(x*.25,0) for x in range(40)])
        self.assertEqual(locks.acquire("agv1",route),[])
        self.assertEqual(locks.acquire("agv2",route),["agv1"])
        self.assertNotIn("agv2",locks.routes)
        locks.release("agv1")
        self.assertEqual(locks.acquire("agv2",route),[])

    def test_parallel_disjoint_routes(self):
        locks=Reservations()
        self.assertEqual(locks.acquire("agv1",route_zones([(0,0),(1,0)])),[])
        self.assertEqual(locks.acquire("agv2",route_zones([(0,5),(1,5)])),[])

    def test_rejected_update_preserves_owner(self):
        locks=Reservations(); locks.acquire("agv1",{(0,0)}); locks.acquire("agv2",{(9,9)})
        self.assertEqual(locks.acquire("agv2",{(0,0),(1,1)}),["agv1"])
        self.assertEqual(locks.routes["agv2"],{(9,9)})

    def test_head_on_and_adjacent_sweeps_overlap(self):
        self.assertTrue(route_zones([(0,0),(0.25,0)]) & route_zones([(0,2.3),(.25,2.3)]))

    def test_planner_routes_around_rack(self):
        obstacle=SimpleNamespace(cx=0,cy=0,hx=1,hy=2,yaw=0,shape="box",min_z=0,max_z=3)
        planner=GridPlanner([obstacle],bounds=(-8,8,-8,8))
        path=planner.route((-5,0),(5,0))
        self.assertTrue(path)
        self.assertTrue(any(abs(y)>3 for x,y in path))
        self.assertFalse(planner.route((-5,0),(0,0)))

    def test_idle_robot_remains_obstacle_without_reservation(self):
        planner=GridPlanner([],bounds=(-8,8,-8,8))
        path=planner.route((-5,0),(5,0),[(0,0,0)])
        self.assertTrue(path)
        self.assertTrue(all(math.hypot(x,y)>=2.7 for x,y in path))
        self.assertFalse(planner.route((-5,0),(0,0),[(0,0,0)]))

    def test_reservations_can_force_alternate_route(self):
        planner=GridPlanner([],bounds=(-8,8,-8,8))
        forbidden={(0,y) for y in range(-10,11)}
        path=planner.route((-5,0),(5,0),forbidden=forbidden)
        self.assertTrue(path)
        self.assertTrue(all(planner.cell(p) not in forbidden for p in path))

    def test_follower_turns_before_advancing_and_aligns_yaw(self):
        planner=GridPlanner([])
        self.assertEqual(track(planner,(0,0,math.pi),[(1,0)])[0],0)
        self.assertGreater(track(planner,(0,0,0),[(1,0)])[0],0)
        v,w=track(planner,(1,0,0),[(1,0)],final_yaw=math.pi/2)
        self.assertEqual(v,0); self.assertGreater(w,0)

    def test_two_controllers_reach_disjoint_goals(self):
        planner=GridPlanner([])
        poses=[(0.,0.,0.),(0.,5.,0.)]
        for _ in range(400):
            for i in range(2):
                v,w=track(planner,poses[i],[(3.,5.*i)],final_yaw=0.)
                x,y,yaw=poses[i]; poses[i]=(x+v*math.cos(yaw)*.05,y+v*math.sin(yaw)*.05,yaw+w*.05)
        for i in range(2):
            self.assertLess(math.dist(poses[i][:2],(3.,5.*i)),.1)

    def test_wait_and_travel_deadlines(self):
        self.assertTrue(request_expired(31,0,0,True))
        self.assertFalse(request_expired(31,0,0,False))
        self.assertTrue(request_expired(181,0,0,False))

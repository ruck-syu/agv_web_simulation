"""Deterministic fleet planning/reservations. No ROS imports.

Routes acquire every swept grid zone atomically: no partial ownership while
waiting. Stationary robots remain obstacles even after a reservation expires.
"""
import heapq
import math


def angle(value):
    return math.atan2(math.sin(value), math.cos(value))


class GridPlanner:
    def __init__(self, obstacles, bounds=(-31, 31, -19, 19), resolution=0.25, radius=1.04):
        self.resolution, self.radius = resolution, radius
        self.bounds = bounds
        self.blocked = set()
        # Half a grid diagonal protects every point of each traversed cell.
        clearance = radius + resolution / math.sqrt(2)
        for obstacle in obstacles:
            if obstacle.min_z >= 0.96 or obstacle.max_z <= 0:
                continue
            extent = math.hypot(obstacle.hx, obstacle.hy) + clearance
            for ix in range(math.floor((obstacle.cx-extent)/resolution), math.ceil((obstacle.cx+extent)/resolution)+1):
                for iy in range(math.floor((obstacle.cy-extent)/resolution), math.ceil((obstacle.cy+extent)/resolution)+1):
                    x, y = ix*resolution-obstacle.cx, iy*resolution-obstacle.cy
                    c, s = math.cos(obstacle.yaw), math.sin(obstacle.yaw)
                    x, y = x*c+y*s, -x*s+y*c
                    distance = (math.hypot(x,y)-obstacle.hx if obstacle.shape == "circle" else
                                math.hypot(max(0,abs(x)-obstacle.hx), max(0,abs(y)-obstacle.hy)))
                    if distance <= clearance:
                        self.blocked.add((ix,iy))

    def cell(self, point):
        return tuple(round(v/self.resolution) for v in point[:2])

    def point(self, cell):
        return tuple(v*self.resolution for v in cell)

    def route(self, start, goal, peers=(), forbidden=frozenset()):
        first, last = self.cell(start), self.cell(goal)
        def free(cell):
            x,y = self.point(cell)
            return (cell not in self.blocked and cell not in forbidden and
                    self.bounds[0] <= x <= self.bounds[1] and self.bounds[2] <= y <= self.bounds[3] and
                    all(math.hypot(x-p[0],y-p[1]) >= 2.7 for p in peers))
        if not free(first) or not free(last):
            return []
        queue = [(0, first)]; costs = {first:0}; previous = {}
        while queue:
            _, current = heapq.heappop(queue)
            if current == last:
                path = [current]
                while path[-1] != first:
                    path.append(previous[path[-1]])
                return [tuple(start[:2])] + [self.point(c) for c in reversed(path)] + [tuple(goal[:2])]
            for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
                nxt = current[0]+dx,current[1]+dy
                cost = costs[current]+1
                if free(nxt) and cost < costs.get(nxt, math.inf):
                    costs[nxt]=cost; previous[nxt]=current
                    heapq.heappush(queue,(cost+abs(nxt[0]-last[0])+abs(nxt[1]-last[1]),nxt))
        return []


def route_zones(path, resolution=0.5, clearance=1.3):
    """Conservative square tiles covering the swept circumcircle of a route."""
    zones=set()
    for x,y in path:
        for ix in range(math.floor((x-clearance)/resolution), math.floor((x+clearance)/resolution)+1):
            for iy in range(math.floor((y-clearance)/resolution), math.floor((y+clearance)/resolution)+1):
                zones.add((ix,iy))
    return zones


class Reservations:
    def __init__(self):
        self.routes = {}

    def acquire(self, robot, zones):
        blockers = sorted(owner for owner, held in self.routes.items() if owner != robot and held & zones)
        if blockers:
            return blockers
        self.routes[robot] = set(zones)
        return []

    def release(self, robot):
        self.routes.pop(robot, None)


def follow(pose, target, final_yaw=None):
    x,y,yaw=pose
    distance=math.hypot(target[0]-x,target[1]-y)
    error=angle((math.atan2(target[1]-y,target[0]-x) if distance>0.08 else
                 yaw if final_yaw is None else final_yaw)-yaw)
    return (min(0.45, distance*1.2) if abs(error)<0.15 and distance>0.08 else 0.0,
            max(-0.8,min(0.8,error*2)))

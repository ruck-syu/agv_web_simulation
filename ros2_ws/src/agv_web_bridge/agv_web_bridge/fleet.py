"""Deterministic fleet planning/reservations. No ROS imports.

Rolling swept-zone reservations and collision-checked any-angle trajectories.
"""
import heapq
import math
from collections import deque
from itertools import chain

from .control import FLEET_WORLD_BOUNDS
from .motion_limits import MAX_ANGULAR_SPEED, SIM_LINEAR_ACCELERATION, SIM_ANGULAR_ACCELERATION

AUTONOMOUS_CRUISE_SPEED = 1.0
LATERAL_ACCELERATION = 0.3
TRUTH_PERIOD = .04
CONTROL_LATENCY = .10 + TRUTH_PERIOD
MOTION_TRUTH_MAX_AGE = .12
PEER_APPROACH_SPEED = .45
PEER_SPEED_RAMP = .43
PEER_BRAKING_END = 5.1
SEPARATION_STOP = 3.0
PEER_CLEARANCE = 3.3
TRAJECTORY_HORIZON = 2.0
POSITION_TOLERANCE = .020
YAW_TOLERANCE = .08
STOPPED_SPEED = .03


def braking_speed(distance, target_speed=0., deceleration=SIM_LINEAR_ACCELERATION):
    """Limit approach speed with a control delay and a corner-speed reserve."""
    if distance <= CONTROL_LATENCY * target_speed:
        return 0.
    allowance = distance - TRUTH_PERIOD * target_speed
    lag = deceleration * CONTROL_LATENCY
    return max(target_speed, math.sqrt(target_speed**2 + 2 * deceleration * allowance + lag**2) - lag)


def peer_speed_limit(separation):
    # Ramp both robots before the 3 m latch, including a manually driven peer.
    return PEER_APPROACH_SPEED + PEER_SPEED_RAMP * max(0., separation - PEER_BRAKING_END)


def curvature_speed(curvature):
    curvature = max(abs(curvature), 1e-6)
    return min(MAX_ANGULAR_SPEED / curvature, math.sqrt(LATERAL_ACCELERATION / curvature))



def angle(value):
    return math.atan2(math.sin(value), math.cos(value))


class GridPlanner:
    def __init__(self, obstacles, bounds=FLEET_WORLD_BOUNDS, resolution=0.25, radius=1.04):
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
        return round(point[0]/self.resolution), round(point[1]/self.resolution)

    def point(self, cell):
        return cell[0]*self.resolution, cell[1]*self.resolution

    def in_bounds(self, point):
        xmin, xmax, ymin, ymax = self.bounds
        return xmin <= point[0] <= xmax and ymin <= point[1] <= ymax

    def route(self, start, goal, peers=(), forbidden=frozenset(), smooth=True):
        if not self.in_bounds(start) or not self.in_bounds(goal):
            return []
        first, last = self.cell(start), self.cell(goal)
        peer_cells = self.peer_cells(peers)
        step = self.resolution
        xmin, xmax, ymin, ymax = self.bounds
        xmin, xmax = math.ceil(xmin/step), math.floor(xmax/step)
        ymin, ymax = math.ceil(ymin/step), math.floor(ymax/step)
        def free(cell):
            x, y = cell
            return (xmin <= x <= xmax and ymin <= y <= ymax and cell not in self.blocked and
                    cell not in peer_cells and (cell not in forbidden or cell in (first,last)))
        if not free(last):
            return []
        if not free(first):
            # The measured start can be clear even when its rounded centre is
            # inside a peer disk. Connect to a neighbouring clear centre.
            if not peers or not self.clear(start, start, peers):
                return []
            x, y = first
            anchors = [(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
            first = min((cell for cell in anchors if free(cell) and
                         self.clear(start, self.point(cell), peers, forbidden)),
                        key=lambda cell: math.dist(start[:2], self.point(cell)), default=None)
            if first is None:
                return []
        # Pad a flat grid with occupied border cells. Its x-major indexing
        # preserves the queue's (x, y) tie order and avoids hashing each edge.
        stride = ymax - ymin + 3
        columns = xmax - xmin + 3
        size = stride * columns
        origin = (1 - xmin) * stride + 1 - ymin
        occupied = bytearray(size)
        occupied[:stride] = occupied[-stride:] = b"\x01" * stride
        occupied[::stride] = occupied[stride-1::stride] = b"\x01" * columns
        reserved = (cell for cell in forbidden if cell not in (first, last))
        for x, y in chain(self.blocked, peer_cells, reserved):
            if xmin <= x <= xmax and ymin <= y <= ymax:
                occupied[x*stride + y + origin] = 1

        source = first[0]*stride + first[1] + origin
        target = last[0]*stride + last[1] + origin
        target_x, target_y = divmod(target, stride)
        queue = [(0, source)]
        costs = [math.inf] * size
        costs[source] = 0
        previous = [-1] * size
        offsets = (stride, -stride, 1, -1)
        while queue:
            _, current = heapq.heappop(queue)
            if occupied[current]:
                continue
            if current == target:
                path = []
                while current != -1:
                    x, y = divmod(current, stride)
                    path.append(self.point((x + xmin - 1, y + ymin - 1)))
                    current = previous[current]
                points = [tuple(start[:2]), *reversed(path), tuple(goal[:2])]
                return self.refine(points, peers, forbidden) if smooth else points
            # The Manhattan heuristic is consistent, so settled cells can
            # also be marked unavailable to all later queue entries.
            occupied[current] = 1
            cost = costs[current] + 1
            for offset in offsets:
                nxt = current + offset
                if not occupied[nxt] and cost < costs[nxt]:
                    costs[nxt] = cost
                    previous[nxt] = current
                    x, y = divmod(nxt, stride)
                    heapq.heappush(queue, (cost + abs(x-target_x) + abs(y-target_y), nxt))
        return []

    def clear(self, a, b, peers=(), forbidden=frozenset()):
        # Visit every cell interval crossed by the segment. Unlike fixed-step
        # sampling this predicate is invariant under subdivision/resampling.
        if not self.in_bounds(a) or not self.in_bounds(b):
            return False
        dx,dy=b[0]-a[0],b[1]-a[1]; length=dx*dx+dy*dy
        for q in peers:
            t=max(0.,min(1.,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/length)) if length else 0.
            if math.hypot(a[0]+t*dx-q[0],a[1]+t*dy-q[1])<PEER_CLEARANCE:
                return False
        step = self.resolution
        first, last = self.cell(a), self.cell(b)
        if first in self.blocked or first in forbidden or last in self.blocked or last in forbidden:
            return False
        if first == last:
            return True

        def crossings(start, end, delta):
            if abs(delta) <= 1e-12:
                return
            lo = math.ceil(min(start, end)/step - .5)
            hi = math.floor(max(start, end)/step - .5)
            indices = range(lo, hi + 1) if delta > 0 else range(hi, lo - 1, -1)
            for k in indices:
                yield max(0., min(1., ((k+.5)*step-start)/delta))

        def occupied(t):
            cell = round((a[0]+dx*t)/step), round((a[1]+dy*t)/step)
            return cell in self.blocked or cell in forbidden

        previous = 0.
        for t in heapq.merge(crossings(a[0], b[0], dx), crossings(a[1], b[1], dy), (1.,)):
            if t <= previous:
                continue
            if occupied((previous+t)/2) or occupied(t):
                return False
            previous = t
        return True

    def peer_cells(self, peers):
        """Rasterize peer disks once per search using the exact centre clearance."""
        step = self.resolution
        peer_cells = set()
        for px, py, *_ in peers:
            for x in range(math.ceil((px-PEER_CLEARANCE)/step), math.floor((px+PEER_CLEARANCE)/step)+1):
                dx = x*step-px
                for y in range(math.ceil((py-PEER_CLEARANCE)/step), math.floor((py+PEER_CLEARANCE)/step)+1):
                    if math.hypot(dx, y*step-py) < PEER_CLEARANCE:
                        peer_cells.add((x, y))
        return peer_cells

    def reachable(self, start, peers=()):
        """BFS through reachable free centres, in increasing escape distance."""
        step = self.resolution
        xmin, xmax, ymin, ymax = self.bounds
        xmin, xmax = math.ceil(xmin/step), math.floor(xmax/step)
        ymin, ymax = math.ceil(ymin/step), math.floor(ymax/step)
        peer_cells = self.peer_cells(peers)
        first=self.cell(start); queue=deque([first]); seen={first}
        while queue:
            x, y = cell = queue.popleft()
            if not (xmin <= x <= xmax and ymin <= y <= ymax) or cell in self.blocked or cell in peer_cells:
                continue
            yield cell
            for nxt in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
                if nxt not in seen:
                    seen.add(nxt); queue.append(nxt)

    def refine(self, points, peers=(), forbidden=frozenset()):
        points = [p for i,p in enumerate(points) if i == 0 or p != points[i-1]]
        # Farthest visible string pulling: near-optimal, not globally optimal.
        path = points[:1]
        i = 0
        while i < len(points)-1:
            j = len(points)-1
            while j > i+1 and not self.clear(points[i],points[j],peers,forbidden):
                j -= 1
            path.append(points[j]); i = j
        return fillet(path, lambda a,b: self.clear(a,b,peers,forbidden))


def sample_path(path, step=.08):
    result = list(path[:1])
    for a,b in zip(path,path[1:]):
        n=max(1, math.ceil(math.dist(a,b)/step))
        result.extend(tuple(a[j]+(b[j]-a[j])*i/n for j in (0,1)) for i in range(1,n+1))
    return result


def fillet(path, clear, radius=.65):
    """Tangent circular fillets; reject unsafe arcs rather than clip obstacles.

    The velocity profile slows for the fillet radius. Unsmoothed corners can pivot.
    """
    out = list(path[:1])
    for a,b,c in zip(path,path[1:],path[2:]):
        ab,bc=math.dist(a,b),math.dist(b,c)
        u=tuple((b[j]-a[j])/ab for j in (0,1))
        v=tuple((c[j]-b[j])/bc for j in (0,1))
        turn=angle(math.atan2(v[1],v[0])-math.atan2(u[1],u[0]))
        trim=radius*math.tan(abs(turn)/2)
        if abs(turn)<1e-5 or abs(turn)>math.pi-.01 or trim>min(ab,bc)*.45:
            out.append(b); continue
        start=tuple(b[j]-u[j]*trim for j in (0,1))
        sign=1 if turn>0 else -1
        center=(start[0]-sign*u[1]*radius,start[1]+sign*u[0]*radius)
        theta=math.atan2(start[1]-center[1],start[0]-center[0])
        n=max(2,math.ceil(abs(turn)*radius/.06))
        arc=[(center[0]+radius*math.cos(theta+turn*i/n),
              center[1]+radius*math.sin(theta+turn*i/n)) for i in range(n+1)]
        if all(clear(x,y) for x,y in zip([out[-1]]+arc,arc+[c])):
            out.extend(arc)
        else:
            out.append(b)
    if len(path)>1: out.append(path[-1])
    emitted=sample_path(out)
    return emitted if all(clear(a,b) for a,b in zip(emitted,emitted[1:])) else sample_path(path)


def lookahead(pose, path, length=TRAJECTORY_HORIZON):
    """Remaining centreline clipped by arclength, starting at actual truth."""
    out=[tuple(pose[:2])]; remaining=length
    for p in path:
        d=math.dist(out[-1],p)
        if d>remaining:
            out.append(tuple(out[-1][j]+(p[j]-out[-1][j])*remaining/d for j in (0,1)))
            break
        out.append(p); remaining-=d
    return sample_path(out)


def route_zones(path, resolution=0.5, clearance=1.3):
    """Conservative square tiles covering the swept circumcircle of a route."""
    zones=set()
    for x,y in sample_path(path, .1):
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


def request_expired(now, started, wait_since, waiting):
    return now-started > 180 or (waiting and now-wait_since > 30)


def reservation_forbidden(planner, held):
    """Planner centres whose full 1.3 m reservation intersects a held tile.

    Endpoint exemptions in GridPlanner allow a search, but acquire() still
    validates the complete sweep, including both endpoints.
    """
    forbidden = set()
    step = planner.resolution
    for ix, iy in held:
        for x in range(math.floor((ix*.5-1.3)/step), math.ceil(((ix+1)*.5+1.3)/step)+1):
            for y in range(math.floor((iy*.5-1.3)/step), math.ceil(((iy+1)*.5+1.3)/step)+1):
                forbidden.add((x,y))
    return forbidden


def projected_motion(pose, velocity):
    """One-second constant-twist arc, sampled for direction gates."""
    x,y,yaw = pose
    v,w = velocity
    for i in range(1,11):
        t=i/10
        if abs(w)<1e-8:
            yield x+v*t*math.cos(yaw), y+v*t*math.sin(yaw)
        else:
            yield x+v/w*(math.sin(yaw+w*t)-math.sin(yaw)), y-v/w*(math.cos(yaw+w*t)-math.cos(yaw))


def retreat_allowed(pose, velocity, peers):
    points=list(projected_motion(pose,velocity))
    return all(all(math.dist(point,peer[:2]) >= math.dist(pose[:2],peer[:2])-1e-8
                   for point in points) for peer in peers)


def manual_route_allowed(pose, velocity, held):
    if not held:
        return True
    def distance(point):
        x,y=point
        return min(math.hypot(max(ix*.5-x,0,x-(ix+1)*.5),
                              max(iy*.5-y,0,y-(iy+1)*.5)) for ix,iy in held)
    def overlap(point):
        # Continuous overlap area avoids locking a robot into tiles its current
        # footprint already intersects (including when its centre is in a tile).
        x,y=point
        return sum(max(0.,min(x+1.3,(ix+1)*.5)-max(x-1.3,ix*.5)) *
                   max(0.,min(y+1.3,(iy+1)*.5)-max(y-1.3,iy*.5))
                   for ix,iy in held)
    previous=distance(pose[:2])
    penetration=overlap(pose[:2])
    for point in projected_motion(pose,velocity):
        current=distance(point)
        area=overlap(point)
        if area > penetration+1e-8:
            return False
        if current < previous-1e-8 and current < 1.3+.5*math.sqrt(2):
            return False
        previous,penetration=current,area
    return True


def corner_limits(path):
    """Distance and curvature speed at each path sample, plus a zero-speed end."""
    distances = [0.]
    for a, b in zip(path, path[1:]):
        distances.append(distances[-1] + math.dist(a, b))
    speeds = [math.inf] * len(path)
    for i, (a, b, c) in enumerate(zip(path, path[1:], path[2:]), 1):
        dx, dy = b[0] - a[0], b[1] - a[1]
        ex, ey = c[0] - b[0], c[1] - b[1]
        scale = math.dist(a, b) * math.dist(b, c) * math.dist(a, c)
        if scale > 1e-12:
            speeds[i] = curvature_speed(2 * (dx * ey - dy * ex) / scale)
    speeds[-1] = 0.
    return list(zip(distances, speeds))


def path_speed(pose, path, profile, speed):
    """Brake for the remaining corner/goal constraints within stopping range."""
    start = profile[0][0]
    # A retained path sample can be either just ahead or just behind the robot.
    # Project onto its tangent so the braking estimate does not include backtracking.
    if len(path) == 1:
        start -= math.dist(pose[:2], path[0])
    else:
        a, b = path[:2]
        length = profile[1][0] - start
        if length > 1e-9:
            start += sum((pose[i] - a[i]) * (b[i] - a[i]) for i in (0, 1)) / length
    for distance, limit in profile:
        if limit and (limit >= speed or distance < start):
            continue
        ahead = distance - start
        if ahead > TRAJECTORY_HORIZON:
            break
        speed = min(speed, braking_speed(ahead, limit))
    return speed


def reachable_arc(pose, measured, command):
    """Acceleration-limited swept centreline from the latest physics sample."""
    x, y, yaw = pose
    v, w = measured
    for _ in range(50):
        dt = .02
        v += max(-SIM_LINEAR_ACCELERATION * dt, min(SIM_LINEAR_ACCELERATION * dt, command[0] - v))
        w += max(-SIM_ANGULAR_ACCELERATION * dt, min(SIM_ANGULAR_ACCELERATION * dt, command[1] - w))
        mid = yaw + w * dt / 2
        x += v * dt * math.cos(mid)
        y += v * dt * math.sin(mid)
        yaw += w * dt
        yield x, y


def track(planner, pose, path, peers=(), final_yaw=None, *,
          cruise=AUTONOMOUS_CRUISE_SPEED, measured=(0., 0.), profile=None):
    """Speed-scaled pursuit with forward braking and checked swept arcs."""
    remaining = math.dist(pose[:2], path[-1])
    pivot = lambda error: max(-MAX_ANGULAR_SPEED, min(MAX_ANGULAR_SPEED, error * 2))
    if remaining <= POSITION_TOLERANCE:
        if abs(measured[0]) > STOPPED_SPEED or final_yaw is None:
            return (0., 0.)
        return 0., pivot(angle(final_yaw - pose[2]))
    speed = path_speed(pose, path, profile or corner_limits(path), cruise)
    # A proportional terminal approach removes residual velocity before the
    # tolerance boundary and leaves room to align yaw after translation stops.
    speed = min(speed, 1.7 * remaining)
    # After braking, creep through a near corner or recover a goal behind the
    # tangent projection. Both recoveries still use the swept-arc checks.
    if speed == 0.:
        if abs(measured[0]) > STOPPED_SPEED:
            return (0., 0.)
        speed = min(.14, 1.7 * remaining)
    limit = .25 + .30 * min(speed, max(.35, abs(measured[0])))
    targets = lookahead(pose, path, limit)[1:]

    def clear_arc(command):
        # Validate travel during one update at the present heading as well as
        # the turn. Close to a cell boundary the curved chord alone can miss it.
        advance = max(abs(measured[0]), command[0]) * CONTROL_LATENCY
        tangent = (pose[0] + advance * math.cos(pose[2]), pose[1] + advance * math.sin(pose[2]))
        if not planner.clear(pose, tangent, peers):
            return False
        for samples in (projected_motion(pose, command), reachable_arc(pose, measured, command)):
            a = pose[:2]
            for b in samples:
                if not planner.clear(a, b, peers):
                    return False
                a = b
        return True

    for target in reversed(targets):
        distance = math.dist(pose[:2], target)
        if distance < min(.08, remaining * .75):
            continue
        error = angle(math.atan2(target[1] - pose[1], target[0] - pose[0]) - pose[2])
        if abs(error) > .8:
            return 0., pivot(error) if abs(measured[0]) <= STOPPED_SPEED else 0.
        if not planner.clear(pose, target, peers):
            continue
        curvature = 2 * math.sin(error) / distance
        velocity = min(speed, curvature_speed(curvature))
        for factor in (1., .5):
            v = velocity * factor
            command = (v, v * curvature)
            if clear_arc(command):
                return command
    target = next((p for p in targets if math.dist(pose[:2],p)>.08), path[-1])
    error = angle(math.atan2(target[1]-pose[1],target[0]-pose[0])-pose[2])
    return 0., pivot(error) if abs(measured[0]) <= STOPPED_SPEED else 0.

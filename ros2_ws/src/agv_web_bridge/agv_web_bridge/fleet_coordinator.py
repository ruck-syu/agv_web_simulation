"""Fleet decision loop shared by ROS transport and deterministic host tests."""
import math
import time
from .control import CommandArbiter, goal_coordinates
from .motion_limits import MAX_LINEAR_SPEED
from .fleet import (AUTONOMOUS_CRUISE_SPEED, MOTION_TRUTH_MAX_AGE, PEER_CLEARANCE, POSITION_TOLERANCE,
                    SEPARATION_STOP, STOPPED_SPEED,
                    TRAJECTORY_HORIZON, YAW_TOLERANCE, corner_limits, peer_speed_limit,
                    Reservations, route_zones, angle,
                    request_expired, reservation_forbidden, retreat_allowed, manual_route_allowed, lookahead, track, sample_path)


ROBOT_IDS = ("agv1", "agv2")
GOAL_CLEARANCE = PEER_CLEARANCE + POSITION_TOLERANCE
SEPARATION_ISSUE = f"Robots must be at least {GOAL_CLEARANCE:.2f} m apart before starting."


class InvalidCruiseSpeed(ValueError):
    pass


class FleetCoordinator:
    def __init__(self, planner, clock=time.monotonic, cruise=AUTONOMOUS_CRUISE_SPEED):
        if (isinstance(cruise, bool) or not isinstance(cruise, (int, float)) or
                not math.isfinite(cruise) or not 0. < cruise <= MAX_LINEAR_SPEED):
            raise InvalidCruiseSpeed(f"autonomous_cruise_speed must be finite and in (0, {MAX_LINEAR_SPEED}] m/s")
        self.cruise = cruise
        self.planner = planner
        self.now = clock
        self.reservations = Reservations()
        self.separation_latched = False
        self.robots = {rid: {
            "control": CommandArbiter(), "pose": None, "truth_time": -math.inf,
            "request_id": None, "pair_id": None, "pair_leg": None, "destination": None,
            "goal": None, "path": [], "profile": [], "velocity": (0., 0.), "state": "idle", "waiting_on": [],
            "requested": 0., "retry": 0., "started": 0., "wait_since": 0.,
            "detail": "Ready"
        } for rid in ROBOT_IDS}

    def publish_plan(self, robot):
        pass

    def publish_velocity(self, rid, velocity):
        pass

    def publish_state(self, state):
        pass

    def stop(self,rid,state,detail):
        pair_id = self.robots[rid]["pair_id"]
        self.reset_goal(rid, state, detail)
        self.robots[rid].update(pair_id=None, destination=None)
        if pair_id is not None and state != "succeeded":
            for peer_id, peer in self.robots.items():
                if peer["pair_id"] == pair_id:
                    self.reset_goal(peer_id, "canceled", f"Paired route interrupted by {rid}: {detail}")
                    peer.update(pair_id=None, destination=None)

    def reset_goal(self,rid,state,detail):
        r=self.robots[rid]
        r["control"].stop(); r["goal"]=None; r["path"]=[]
        r["state"],r["detail"],r["waiting_on"]=state,detail,[]
        r.pop("yield_target",None)
        r.pop("yield_return",None)
        r.pop("optimize_pending",None)
        r.pop("next_optimize",None)
        self.reservations.release(rid)
        self.publish_velocity(rid,(0.,0.))
        self.publish_plan(r)

    def manual(self,rid,velocity):
        if not all(math.isfinite(v) for v in velocity):
            return
        r=self.robots[rid]
        if all(v==0. for v in velocity) and r["state"]!="manual":
            # Idle/release zeros must not cancel autonomy; only real input takes over.
            return
        if r["state"]!="manual":
            self.stop(rid,"manual","Manual takeover")
        r["control"].receive_manual(*velocity,self.now())

    def command(self,rid,payload):
        if not isinstance(payload,dict):
            return
        if payload.get("action") in ("cancel","stop"):
            self.stop(rid,"canceled","Operator stop"); return
        if payload.get("action") != "goal":
            return
        goal=goal_coordinates(payload)
        r=self.robots[rid]; now=self.now()
        request_id=payload.get("request_id") if isinstance(payload.get("request_id"),str) else None
        if r["goal"] is not None and r["goal"]==goal:
            # A resent identical goal keeps its reservations and timers; only adopt a new id.
            if request_id is not None and r["pair_id"] is None:
                r["request_id"]=request_id
            return
        if r["pair_id"] is not None:
            self.stop(rid, "canceled", "Goal superseded")
        r["pair_leg"] = None
        r["request_id"]=request_id
        issue = self.goal_issue(goal)
        if issue:
            self.stop(rid,"failed",issue); return
        if not self.ready(r,now):
            self.stop(rid,"unavailable","Fresh truth, odom, scan and heartbeat required"); return
        peer = next(p for other, p in self.robots.items() if other != rid)
        if peer["pose"] is not None and now - peer["truth_time"] < 1.5:
            separation = math.dist(r["pose"][:2], peer["pose"][:2])
            if separation < GOAL_CLEARANCE:
                safety = separation < (PEER_CLEARANCE if self.separation_latched else SEPARATION_STOP)
                self.stop(rid, "safety_stop" if safety else "failed", SEPARATION_ISSUE)
                return
        self.begin_goal(rid, goal, request_id, now)

    def goal_issue(self, goal, label="Goal"):
        if goal is None:
            return f"{label} requires finite x, y and yaw numbers."
        if not self.planner.in_bounds(goal):
            xmin, xmax, ymin, ymax = self.planner.bounds
            return f"{label} is outside world bounds (x {xmin:g} to {xmax:g} m, y {ymin:g} to {ymax:g} m)."
        return None

    def start_pair(self, payload):
        """Handle ordered fleet stops and atomically admit paired goals."""
        if not isinstance(payload, dict):
            return None
        if payload.get("action") == "stop":
            self.stop_all()
            return None
        if not isinstance(payload.get("request_id"), str):
            return None
        request_id = payload["request_id"]
        now = self.now()
        goals, destinations, issues = {}, {}, {}
        poses = [self.robots[rid]["pose"] for rid in ROBOT_IDS]
        fresh = all(pose is not None and now - self.robots[rid]["truth_time"] < 1.5
                    for rid, pose in zip(ROBOT_IDS, poses))
        separation = math.dist(poses[0][:2], poses[1][:2]) if fresh else 0.
        motion_fresh = fresh and all(now - r["truth_time"] <= MOTION_TRUTH_MAX_AGE
                                     for r in self.robots.values())
        threshold = PEER_CLEARANCE if self.separation_latched else SEPARATION_STOP
        speed_limit = peer_speed_limit(separation)
        commands = payload.get("goals")
        next_legs = payload.get("destinations")
        for rid in ROBOT_IDS:
            r = self.robots[rid]
            goals[rid] = goal_coordinates(commands.get(rid)) if isinstance(commands, dict) else None
            destinations[rid] = goal_coordinates(next_legs.get(rid)) if isinstance(next_legs, dict) else None
            source_issue = self.goal_issue(goals[rid], "Source goal")
            destination_issue = self.goal_issue(destinations[rid], "Destination goal") if "destinations" in payload else None
            if source_issue or destination_issue:
                issues[rid] = source_issue or destination_issue
            elif r["goal"] is not None:
                issues[rid] = "Already running."
            elif not self.ready(r, now):
                issues[rid] = "Fresh truth, odometry, floor scan and heartbeat required."
            elif fresh and not motion_fresh:
                issues[rid] = "Both world poses must be current before starting."
            elif fresh and separation < threshold:
                issues[rid] = "Safety stop active."
            elif fresh and separation < GOAL_CLEARANCE:
                issues[rid] = SEPARATION_ISSUE
            elif fresh and speed_limit < MAX_LINEAR_SPEED and abs(r["velocity"][0]) > speed_limit:
                issues[rid] = "Measured speed exceeds the nearby-peer limit. Slow down before starting."
            elif not self.planner.route(r["pose"], goals[rid]):
                issues[rid] = "Source rack is unreachable."
            elif destinations[rid] is not None and not self.planner.route(goals[rid], destinations[rid]):
                issues[rid] = "Destination rack is unreachable."
        # Each robot advances independently, so source/destination combinations can overlap in time.
        if not issues:
            first, second = ROBOT_IDS
            for first_label, first_goal in (("source", goals[first]), ("destination", destinations[first])):
                for second_label, second_goal in (("source", goals[second]), ("destination", destinations[second])):
                    if first_goal is not None and second_goal is not None and (
                            math.dist(first_goal[:2], second_goal[:2]) < GOAL_CLEARANCE):
                        issues.setdefault(first, f"Selected {first_label} rack is too close to {second}'s {second_label} rack.")
                        issues.setdefault(second, f"Selected {second_label} rack is too close to {first}'s {first_label} rack.")
        if issues:
            return {"request_id": request_id, "issues": issues}
        for rid in ROBOT_IDS:
            self.begin_goal(rid, goals[rid], request_id, now)
            self.robots[rid].update(pair_id=request_id, pair_leg=0, destination=destinations[rid])
        return None

    def cancel_pair(self, request_id):
        for rid, robot in self.robots.items():
            if robot["pair_id"] == request_id:
                self.stop(rid, "canceled", "Operator stop")
                return

    def stop_all(self):
        for rid in ROBOT_IDS:
            self.stop(rid, "canceled", "Operator stop")

    def begin_goal(self, rid, goal, request_id, now):
        r = self.robots[rid]
        self.reset_goal(rid,"waiting","Planning and requesting route zones")
        r.update(request_id=request_id,goal=goal,requested=now,retry=0.,started=now,wait_since=now,progress_pose=r["pose"],progress_time=now,translation_time=now)
        r["control"].start()

    def ready(self,r,now):
        return (r["pose"] is not None and now-r["truth_time"]<1.5 and
                r["control"].sensors_ready(now) and r["control"].operator_ready(now))

    def optimization_candidate(self, rid):
        r = self.robots[rid]
        peers = [p["pose"] for i, p in self.robots.items() if i != rid and p["pose"]]
        return self.planner.route(r["pose"], r["goal"], peers)

    def plan(self,rid,now, optimize=False):
        """Apply a plan synchronously. The ROS override returns False while pending."""
        r=self.robots[rid]
        old_target=r.pop("yield_target",None)
        peers=[p["pose"] for i,p in self.robots.items() if i!=rid and p["pose"]]
        for other,p in self.robots.items():
            if other!=rid and p["pose"] and not p["goal"] and math.dist(r["goal"][:2],p["pose"][:2])<PEER_CLEARANCE:
                self.stop(rid,"failed",f"Goal blocked by parked {other}")
                return
        priority = lambda i: (self.robots[i]["requested"], i)
        higher = [i for i,p in self.robots.items() if i != rid and p["goal"] and priority(i)<priority(rid)]
        held=set().union(*(z for owner,z in self.reservations.routes.items() if owner!=rid))
        path=self.planner.route(r["pose"],r["goal"],peers)
        # Predict near-future peer occupancy, with priority breaking symmetry.
        predicted=[q for i in higher for q in lookahead(self.robots[i]["pose"], self.robots[i]["path"],TRAJECTORY_HORIZON)]
        if predicted and path and any(not self.planner.clear(a,b,predicted) for a,b in zip(path,path[1:])):
            alternate=self.planner.route(r["pose"],r["goal"],peers+predicted)
            if alternate:
                path=alternate
        blockers=self.reservations.acquire(rid,route_zones(lookahead(r["pose"],path),clearance=1.3)) if path else ["occupied_or_unreachable"]
        if not path:
            holders=[i for i,p in self.robots.items() if i!=rid and p["goal"] and i in self.reservations.routes]
            if holders: blockers=holders
        forbidden = None
        if blockers and held:
            forbidden=reservation_forbidden(self.planner,held)
            alternate=self.planner.route(r["pose"],r["goal"],peers,forbidden)
            if alternate and not self.reservations.acquire(rid,route_zones(lookahead(r["pose"],alternate),clearance=1.3)):
                path=alternate; blockers=[]
        # Lower priority retreats to a reachable holding point when its body
        # obstructs the winner. Original goal and absolute deadline are retained.
        if higher and peers and (blockers or math.dist(r["pose"][:2],self.robots[higher[0]]["pose"][:2])<8):
            peer=self.robots[higher[0]]
            conflict=bool(blockers) or not path or any(math.dist(q,r["pose"][:2])<4.0 for q in peer["path"])
            if (conflict and (blockers or not path or math.dist(r["pose"][:2],peer["pose"][:2])<5.)
                    and not held & route_zones([r["pose"][:2]])):
                # Search the reachable component, not a fixed offset stencil.
                # The complete winner route and parked goal must stay clear.
                corridor=sample_path([peer["pose"][:2]]+peer["path"]+[peer["goal"][:2]])
                goals_conflict = math.dist(r["goal"][:2], peer["goal"][:2]) < PEER_CLEARANCE
                key = (self.planner, r["goal"], peer["goal"])
                if not goals_conflict and r.get("yield_return", (None,))[0] != key:
                    r["yield_return"] = key, set(), self.planner.reachable(r["goal"], [peer["goal"]])
                if forbidden is None:
                    forbidden=reservation_forbidden(self.planner,held)
                for cell in self.planner.reachable(r["pose"],peers):
                    target=self.planner.point(cell)
                    if any(math.dist(target,q)<3.8 for q in corridor):
                        continue
                    if not goals_conflict:
                        _, returning, frontier = r["yield_return"]
                        if cell not in returning:
                            for reached in frontier:
                                returning.add(reached)
                                if reached == cell:
                                    break
                        if cell not in returning:
                            continue
                    escape=self.planner.route(r["pose"],target,peers,forbidden)
                    if escape and not self.reservations.acquire(rid,route_zones(lookahead(r["pose"],escape),clearance=1.3)):
                        path=escape; blockers=[]; r["yield_target"]=escape[-1]; break
        if blockers:
            if optimize:
                if old_target is not None: r["yield_target"]=old_target
                return
            # A parked peer may sever the route even far from the endpoint.
            parked=[(i,p["pose"]) for i,p in self.robots.items() if i!=rid and p["pose"] and not p["goal"]]
            if not path and parked and self.planner.route(r["pose"],r["goal"]):
                self.stop(rid,"failed",f"Route blocked by parked {parked[0][0]}"); return
            if r["state"]!="waiting": r["wait_since"]=now
            self.reservations.release(rid)
            r["path"]=[]; r["waiting_on"]=blockers; r["state"]="waiting"
            r["detail"]="Waiting at conflict; replanning"; r["retry"]=now+1.
            self.publish_plan(r)
            return
        r.setdefault("progress_pose",r["pose"]); r.setdefault("progress_time",now)
        r["path"]=path; r["profile"]=corner_limits(path); r["state"]="navigating"; r["waiting_on"]=[]
        # Give a freshly planned route its full optimizer interval. In
        # particular, don't repeat its A* in the tick that leaves a yield bay.
        r["next_optimize"] = now + 2.
        r["replans"]=r.get("replans",0)+1
        r["detail"]="Yielding to priority robot" if r.get("yield_target") else "Following rolling reserved route"
        self.publish_plan(r)

    def tick(self):
        now=self.now()
        poses=[r["pose"] for r in self.robots.values()]
        fresh=all(p is not None and now-r["truth_time"]<1.5 for p,r in zip(poses,self.robots.values()))
        separation=math.dist(poses[0][:2],poses[1][:2]) if fresh else 0.
        if fresh:
            self.separation_latched=separation < (PEER_CLEARANCE if self.separation_latched else SEPARATION_STOP)
        safety=not fresh or self.separation_latched
        motion_fresh = fresh and all(now-r["truth_time"] <= MOTION_TRUTH_MAX_AGE for r in self.robots.values())
        # Refresh only from a live holder that is still making physical progress.
        # The waiter's own 180 s trip cap remains absolute.
        for r in self.robots.values():
            if r["goal"] and r["state"]=="waiting":
                for owner in r["waiting_on"]:
                    holder=self.robots.get(owner)
                    if (holder and holder["goal"] and holder["path"] and
                        now-holder.get("translation_time",holder["started"])<=8 and now-holder["started"]<=180):
                        r["wait_since"]=now
        # Arrival order then robot id is deterministic; waiting requests own no zones.
        for rid,r in sorted(self.robots.items(),key=lambda item:(item[1]["requested"],item[0])):
            c=r["control"]; velocity=(0.,0.)
            if r["goal"]:
                if not self.ready(r,now) or safety:
                    self.stop(rid,"safety_stop","Stale telemetry/heartbeat or separation stop (3.0 m, clears at 3.3 m)")
                elif request_expired(now,r["started"],r["wait_since"],r["state"]=="waiting"):
                    self.stop(rid,"failed","Bounded route wait/travel timeout; submit a new goal")
                else:
                    moving = abs(r["velocity"][0]) > STOPPED_SPEED
                    if not r["path"] and now>=r["retry"] and not moving:
                        self.plan(rid,now)
                    # Moving obstacles can disappear after we commit to a long
                    # detour. Reconsider the full remaining route every 2 s;
                    # require a material saving to avoid path/heading jitter.
                    if r.pop("optimize_pending", False):
                        if moving:
                            r["optimize_pending"] = True
                            self.publish_velocity(rid, (0., 0.))
                            continue
                        if self.plan(rid, now, optimize=True) is False:
                            r["optimize_pending"] = True
                            self.publish_velocity(rid, (0., 0.))
                            continue
                        if r["goal"] is None:
                            continue
                    if r["path"] and not r.get("yield_target") and now>=r.get("next_optimize",0):
                        candidate=self.optimization_candidate(rid)
                        length=lambda p: sum(math.dist(a,b) for a,b in zip(p,p[1:]))
                        if candidate is not None:
                            r["next_optimize"]=now+2.
                        if candidate and length(candidate)+.75 < length([r["pose"][:2]]+r["path"]):
                            if moving:
                                # A replacement starts at the measured pose. Finish braking
                                # on the held route before publishing its new tangent.
                                r["optimize_pending"] = True
                                self.publish_velocity(rid, (0., 0.))
                                continue
                            if self.plan(rid, now, optimize=True) is False:
                                r["optimize_pending"] = True
                                self.publish_velocity(rid, (0., 0.))
                                continue
                            if r["goal"] is None:
                                continue
                    if r["path"] and math.dist(r["pose"][:2],r["progress_pose"][:2])>0.15:
                        r["progress_pose"]=r["pose"]; r["progress_time"]=now; r["translation_time"]=now
                    if r["path"] and now-r["progress_time"]>8:
                        r.pop("yield_target",None)
                        self.reservations.release(rid); r["path"]=[]; r["state"]="waiting"
                        r["detail"]="No progress; stopped for replanning"; r["retry"]=now+1.; r["wait_since"]=now
                        r["progress_time"]=now; r["progress_pose"]=r["pose"]
                        self.publish_plan(r)
                    if r["path"]:
                        # Project onto the remaining dense trajectory, then track
                        # a short, checked chord. Do not stop at every sample.
                        nearest=min(range(len(r["path"])),key=lambda i: math.dist(r["pose"][:2],r["path"][i]))
                        r["path"]=r["path"][nearest:]
                        r["profile"]=r["profile"][nearest:]
                        if r.get("yield_target") and math.dist(r["pose"][:2],r["yield_target"])<=POSITION_TOLERANCE and abs(r["velocity"][0])<=STOPPED_SPEED:
                            r.pop("yield_target"); r["path"]=[]; r["retry"]=now+1.
                        peers=[p["pose"] for i,p in self.robots.items() if i!=rid and p["pose"]]
                        horizon=lookahead(r["pose"],r["path"])
                        conflict=any(not self.planner.clear(a,b,peers) for a,b in zip(horizon,horizon[1:]))
                        blocked=self.reservations.acquire(rid,route_zones(horizon,clearance=1.3))
                        if conflict or blocked:
                            if moving:
                                self.publish_velocity(rid, (0., 0.))
                                continue
                            self.plan(rid,now)
                            if r["goal"] is None:
                                continue  # terminal replan already published stop and clear
                            horizon=lookahead(r["pose"],r["path"])
                            blocked=self.reservations.acquire(rid,route_zones(horizon,clearance=1.3)) if r["path"] else ["no_route"]
                            conflict=any(not self.planner.clear(a,b,peers) for a,b in zip(horizon,horizon[1:]))
                        if math.dist(r["pose"][:2],r["goal"][:2])<=POSITION_TOLERANCE and abs(angle(r["goal"][2]-r["pose"][2]))<YAW_TOLERANCE and abs(r["velocity"][0])<=STOPPED_SPEED and abs(r["velocity"][1])<=.15:
                            if r["destination"] is None:
                                self.stop(rid,"succeeded","Goal reached")
                            else:
                                self.begin_goal(rid, r["destination"], r["request_id"], now)
                                r.update(pair_leg=1, destination=None)
                        else:
                            if r["path"] and not blocked and not conflict:
                                velocity=track(self.planner,r["pose"],r["path"],peers,
                                    r["goal"][2] if not r.get("yield_target") else None,
                                    cruise=min(self.cruise, peer_speed_limit(separation)),
                                    measured=r["velocity"], profile=r["profile"])
                            if blocked or conflict:
                                self.reservations.acquire(rid,route_zones([r["pose"][:2]]))
                                r["waiting_on"]=blocked or [i for i in self.robots if i!=rid]
                                r["detail"]="Holding at conflict; replanning"
            else:
                velocity=c.command(now)
            if not motion_fresh or not c.sensors_ready(now):
                velocity=(0.,0.)
            elif c.mode=="manual" and r["pose"]:
                peers=[p["pose"] for i,p in self.robots.items() if i!=rid and p["pose"]]
                cap=peer_speed_limit(separation)
                scale=min(1.,cap/max(abs(velocity[0]),1e-9))
                velocity=(velocity[0]*scale,velocity[1]*scale)
                if safety:
                    velocity=(max(-.2,min(.2,velocity[0])),max(-.3,min(.3,velocity[1])))
                    if not retreat_allowed(r["pose"],velocity,peers):
                        velocity=(0.,0.)
                held=set().union(*(z for owner,z in self.reservations.routes.items() if owner!=rid))
                if not manual_route_allowed(r["pose"],velocity,held):
                    velocity=(0.,0.)
            elif safety:
                velocity=(0.,0.)
            self.publish_velocity(rid,velocity)
        state={"schema_version":1,"frame_id":"world","stamp":now,
               "safety_stop":safety,"separation_m":separation if fresh else None,"robots":{},"reserved_zones":{}}
        for rid,r in self.robots.items():
            status={"state":r["state"],"detail":r["detail"],"mode":r["control"].mode,
                    "request_id":r["request_id"],"goal":r["goal"],"pose":r["pose"],"waiting_on":r["waiting_on"],
                    "ready":self.ready(r,now),"busy":r["goal"] is not None,
                    "replans":r.get("replans",0),"yielding":bool(r.get("yield_target")),"reservation_lookahead_m":TRAJECTORY_HORIZON}
            if r["pair_leg"] is not None:
                status["pair_leg"] = r["pair_leg"]
            state["robots"][rid]=status
            state["reserved_zones"][rid]=[list(z) for z in sorted(self.reservations.routes.get(rid,set()))]
        self.publish_state(state)
        return state

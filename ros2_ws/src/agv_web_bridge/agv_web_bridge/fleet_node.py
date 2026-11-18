"""ROS transport and watchdogs for the pure Python fleet planner."""
import json
import math
import time
import signal
from concurrent.futures import ThreadPoolExecutor
from copy import copy
import rclpy
from rclpy.duration import Duration
from rclpy.logging import get_logger
from rclpy.node import Node
from rclpy.qos import QoSProfile
from geometry_msgs.msg import Twist, TwistStamped, PoseStamped
from nav_msgs.msg import Odometry, Path
from rcl_interfaces.msg import ParameterDescriptor
from sensor_msgs.msg import LaserScan
from std_msgs.msg import String
from .fleet import (AUTONOMOUS_CRUISE_SPEED, MOTION_TRUTH_MAX_AGE, PEER_CLEARANCE,
                    SEPARATION_STOP, STOPPED_SPEED, GridPlanner, lookahead, route_zones)
from .fleet_coordinator import FleetCoordinator, InvalidCruiseSpeed
from .motion_limits import FLEET_COMMAND_LIFESPAN, FLEET_VELOCITY_TOPIC
from .simulation_node import SimulationNode


def search_plan(planner, robots, reservations, rid, now, optimize):
    peer = next(robot for other, robot in robots.items() if other != rid)
    peer_pose, peer_goal = peer["pose"], peer["goal"]
    coordinator = FleetCoordinator(planner)
    coordinator.robots = robots
    coordinator.reservations.routes = reservations
    coordinator.plan(rid, now, optimize)
    return coordinator.robots[rid], peer_pose, peer_goal


class FleetNode(Node, FleetCoordinator):
    def __init__(self):
        super().__init__("fleet_coordinator")
        config=SimulationNode._load_config(SimulationNode._default_config_path())
        cruise = self.declare_parameter("autonomous_cruise_speed", AUTONOMOUS_CRUISE_SPEED,
                                        ParameterDescriptor(read_only=True, dynamic_typing=True)).value
        try:
            FleetCoordinator.__init__(self, GridPlanner(SimulationNode._build_obstacles(config)), cruise=cruise)
        except InvalidCruiseSpeed:
            self.destroy_node()
            raise
        self.planning = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fleet-planning")
        self.plan_jobs = {}
        self.optimizer_jobs = {}
        velocity_qos = QoSProfile(depth=1, lifespan=Duration(seconds=FLEET_COMMAND_LIFESPAN))
        for rid,robot in self.robots.items():
            robot["output"] = self.create_publisher(TwistStamped, f"/{rid}/{FLEET_VELOCITY_TOPIC}", velocity_qos)
            robot["diagnostic_output"] = self.create_publisher(Twist, f"/{rid}/cmd_vel", velocity_qos)
            robot["status"]=self.create_publisher(String,f"/{rid}/agv_web/navigation_status",10)
            robot["plan"]=self.create_publisher(Path,f"/{rid}/plan",10)
            self.create_subscription(Odometry,f"/{rid}/agv_web/ground_truth",lambda msg,r=robot:self.truth(r,msg),1)
            self.create_subscription(Odometry,f"/{rid}/odom",lambda msg,r=robot:setattr(r["control"],"odom_time",time.monotonic()),10)
            self.create_subscription(LaserScan,f"/{rid}/scan_obstacles",lambda msg,r=robot:setattr(r["control"],"scan_time",time.monotonic()),10)
            self.create_subscription(String,f"/{rid}/agv_web/operator_heartbeat",lambda msg,r=robot:self.heartbeat(r,msg),10)
            self.create_subscription(String,f"/{rid}/agv_web/navigation_command",lambda msg,i=rid:self.command(i,msg),10)
            self.create_subscription(Twist,f"/{rid}/agv_web/manual_cmd_vel",lambda msg,i=rid:self.manual(i,msg),10)
        self.pair_result = self.create_publisher(String, "/fleet/start_pair_result", 10)
        self.create_subscription(String, "/fleet/start_pair", self.pair_command, 10)
        self.state_output=self.create_publisher(String,"/fleet/state",10)
        self.create_timer(0.1,self.tick)

    def destroy_node(self):
        if hasattr(self, "planning"):
            self.planning.shutdown(cancel_futures=True)
        return super().destroy_node()

    @staticmethod
    def plan_key(robot):
        return robot["started"], robot["goal"], robot.get("replans", 0)

    def plan(self, rid, now, optimize=False):
        if rid not in self.plan_jobs:
            robots = {i: dict(r, control=copy(r["control"])) for i, r in self.robots.items()}
            job = self.planning.submit(search_plan, self.planner, robots,
                                       self.reservations.routes.copy(), rid, now, optimize)
            self.plan_jobs[rid] = self.plan_key(robots[rid]), robots[rid]["pose"], optimize, job
        return False

    def optimization_candidate(self, rid):
        r = self.robots[rid]
        key = self.plan_key(r)
        if rid not in self.optimizer_jobs:
            peers = [peer["pose"] for i, peer in self.robots.items() if i != rid and peer["pose"]]
            job = self.planning.submit(self.planner.route, r["pose"], r["goal"], peers)
            self.optimizer_jobs[rid] = key, r["pose"], job
            return None
        original_key, start, job = self.optimizer_jobs[rid]
        if not job.done():
            return None
        del self.optimizer_jobs[rid]
        if original_key != key or math.dist(start[:2], r["pose"][:2]) > .3:
            return []
        return job.result()

    def apply_plans(self):
        now = self.now()
        for rid, (key, start, optimize, job) in list(self.plan_jobs.items()):
            if not job.done():
                continue
            del self.plan_jobs[rid]
            r = self.robots[rid]
            if not r["goal"] or key != self.plan_key(r):
                continue
            if optimize:
                r.pop("optimize_pending", None)
            peer = next(p for i, p in self.robots.items() if i != rid)
            if (not self.ready(r, now) or peer["pose"] is None or
                    any(now-p["truth_time"] > MOTION_TRUTH_MAX_AGE for p in (r, peer)) or
                    math.dist(r["pose"][:2], peer["pose"][:2]) <
                    (PEER_CLEARANCE if self.separation_latched else SEPARATION_STOP) or
                    abs(r["velocity"][0]) > STOPPED_SPEED or math.dist(start[:2], r["pose"][:2]) > .075):
                continue
            planned, peer_pose, peer_goal = job.result()
            if "yield_return" in planned:
                r["yield_return"] = planned["yield_return"]
            if planned["goal"] is None:
                # Only the parked-peer diagnostics can terminate a plan search.
                # Confirm that the peer is still parked at the sampled pose.
                if peer["goal"] is None and peer_pose and math.dist(peer["pose"][:2], peer_pose[:2]) < .05:
                    self.stop(rid, planned["state"], planned["detail"])
                continue
            if planned.get("replans", 0) == r.get("replans", 0):
                if not optimize:
                    if r["state"] != "waiting":
                        r["wait_since"] = now
                    r.update(path=[], state="waiting", waiting_on=planned["waiting_on"],
                             detail=planned["detail"], retry=now+1.)
                    r.pop("yield_target", None)
                    self.reservations.release(rid)
                    self.publish_plan(r)
                continue
            path = planned["path"]
            if planned.get("yield_target") and peer["goal"] != peer_goal:
                continue
            horizon = lookahead(r["pose"], path)
            if (any(not self.planner.clear(a, b, [peer["pose"]]) for a, b in zip(horizon, horizon[1:])) or
                    self.reservations.acquire(rid, route_zones(horizon))):
                continue
            for field in ("path", "profile", "state", "detail", "waiting_on", "replans"):
                r[field] = planned[field]
            r.pop("yield_target", None)
            if "yield_target" in planned:
                r["yield_target"] = planned["yield_target"]
            r["next_optimize"] = now + 2.
            self.publish_plan(r)

    def tick(self):
        self.apply_plans()
        return FleetCoordinator.tick(self)

    def truth(self,r,msg):
        p,q=msg.pose.pose.position,msg.pose.pose.orientation
        values=(p.x,p.y,2*math.atan2(q.z,q.w))
        velocity = (msg.twist.twist.linear.x, msg.twist.twist.angular.z)
        if all(math.isfinite(v) for v in values + velocity):
            r["pose"] = values
            r["velocity"] = velocity
            stamp = msg.header.stamp.sec + msg.header.stamp.nanosec / 1e9
            received = self.get_clock().now().nanoseconds / 1e9
            r["truth_time"] = time.monotonic() - max(0., received - stamp)

    def heartbeat(self,r,msg):
        if msg.data=="alive":
            r["control"].heartbeat_time=time.monotonic()

    def command(self, rid, msg):
        try:
            payload = json.loads(msg.data)
        except (ValueError, TypeError):
            return
        FleetCoordinator.command(self, rid, payload)

    def pair_command(self, msg):
        try:
            payload = json.loads(msg.data)
        except (ValueError, TypeError):
            return
        if isinstance(payload, dict) and payload.get("action") == "cancel":
            request_id = payload.get("request_id")
            if isinstance(request_id, str):
                self.cancel_pair(request_id)
            return
        result = self.start_pair(payload)
        if result is not None:
            self.pair_result.publish(String(data=json.dumps(result)))

    def manual(self, rid, msg):
        FleetCoordinator.manual(self, rid, (msg.linear.x, msg.angular.z))

    def publish_velocity(self, rid, velocity):
        msg = TwistStamped()
        msg.header.stamp.sec, msg.header.stamp.nanosec = divmod(time.time_ns(), 10**9)
        msg.twist.linear.x, msg.twist.angular.z = velocity
        self.robots[rid]["output"].publish(msg)
        self.robots[rid]["diagnostic_output"].publish(msg.twist)

    def publish_state(self, state):
        state["stamp"] = self.get_clock().now().nanoseconds / 1e9
        for rid, status in state["robots"].items():
            self.robots[rid]["status"].publish(String(data=json.dumps(status, allow_nan=False)))
        self.state_output.publish(String(data=json.dumps(state, allow_nan=False)))

    def publish_plan(self,r):
        msg=Path(); msg.header.frame_id="world"; msg.header.stamp=self.get_clock().now().to_msg()
        for x,y in r["path"]:
            p=PoseStamped(); p.header=msg.header; p.pose.position.x=x; p.pose.position.y=y; p.pose.orientation.w=1.
            msg.poses.append(p)
        r["plan"].publish(msg)



def main(args=None):
    rclpy.init(args=args)
    try:
        node = FleetNode()
    except InvalidCruiseSpeed as error:
        get_logger("fleet_coordinator").fatal(str(error))
        rclpy.try_shutdown()
        raise SystemExit(2) from None
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        if rclpy.ok():
            for rid in node.robots:
                node.stop(rid,"canceled","Shutdown")
        node.destroy_node()
        rclpy.try_shutdown()

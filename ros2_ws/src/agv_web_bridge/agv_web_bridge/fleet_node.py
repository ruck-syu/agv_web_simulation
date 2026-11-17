"""ROS transport and watchdogs for the pure Python fleet planner."""
import json
import math
import time
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist, PoseStamped
from nav_msgs.msg import Odometry, Path
from sensor_msgs.msg import LaserScan
from std_msgs.msg import String
from .control import CommandArbiter, valid_goal
from .fleet import GridPlanner, Reservations, route_zones, follow, angle
from .simulation_node import SimulationNode


class FleetNode(Node):
    def __init__(self):
        super().__init__("fleet_coordinator")
        config=SimulationNode._load_config(SimulationNode._default_config_path())
        self.planner=GridPlanner(SimulationNode._build_obstacles(config))
        self.reservations=Reservations()
        self.robots={}
        for rid in ("agv1","agv2"):
            robot={"control":CommandArbiter(),"pose":None,"truth_time":-math.inf,
                   "goal":None,"path":[],"state":"idle","waiting_on":[],
                   "requested":0.,"retry":0.,"started":0.,"detail":"Ready"}
            self.robots[rid]=robot
            robot["output"]=self.create_publisher(Twist,f"/{rid}/cmd_vel",10)
            robot["status"]=self.create_publisher(String,f"/{rid}/agv_web/navigation_status",10)
            robot["plan"]=self.create_publisher(Path,f"/{rid}/plan",10)
            self.create_subscription(Odometry,f"/{rid}/agv_web/ground_truth",lambda msg,r=robot:self.truth(r,msg),10)
            self.create_subscription(Odometry,f"/{rid}/odom",lambda msg,r=robot:setattr(r["control"],"odom_time",time.monotonic()),10)
            self.create_subscription(LaserScan,f"/{rid}/scan_obstacles",lambda msg,r=robot:setattr(r["control"],"scan_time",time.monotonic()),10)
            self.create_subscription(String,f"/{rid}/agv_web/operator_heartbeat",lambda msg,r=robot:self.heartbeat(r,msg),10)
            self.create_subscription(String,f"/{rid}/agv_web/navigation_command",lambda msg,i=rid:self.command(i,msg),10)
            self.create_subscription(Twist,f"/{rid}/agv_web/manual_cmd_vel",lambda msg,i=rid:self.manual(i,msg),10)
        self.state_output=self.create_publisher(String,"/fleet/state",10)
        self.create_timer(0.1,self.tick)

    def truth(self,r,msg):
        p,q=msg.pose.pose.position,msg.pose.pose.orientation
        values=(p.x,p.y,2*math.atan2(q.z,q.w))
        if all(math.isfinite(v) for v in values):
            r["pose"]=values; r["truth_time"]=time.monotonic()

    def heartbeat(self,r,msg):
        if msg.data=="alive":
            r["control"].heartbeat_time=time.monotonic()

    def stop(self,rid,state,detail):
        r=self.robots[rid]
        r["control"].stop(); r["goal"]=None; r["path"]=[]
        r["state"],r["detail"],r["waiting_on"]=state,detail,[]
        self.reservations.release(rid)
        r["output"].publish(Twist())
        self.publish_plan(r)

    def manual(self,rid,msg):
        if not all(math.isfinite(v) for v in (msg.linear.x,msg.angular.z)):
            return
        self.stop(rid,"manual","Manual takeover")
        self.robots[rid]["control"].receive_manual(msg.linear.x,msg.angular.z,time.monotonic())

    def command(self,rid,msg):
        try:
            payload=json.loads(msg.data)
        except (ValueError,TypeError):
            return
        if not isinstance(payload,dict):
            return
        if payload.get("action") in ("cancel","stop"):
            self.stop(rid,"canceled","Operator stop"); return
        goal=valid_goal(payload)
        if goal is None:
            return
        r=self.robots[rid]; now=time.monotonic()
        if not self.ready(r,now):
            self.stop(rid,"unavailable","Fresh truth, odom, scan and heartbeat required"); return
        self.stop(rid,"waiting","Planning and requesting route zones")
        r.update(goal=goal,requested=now,retry=0.,started=now)
        r["control"].start()

    def ready(self,r,now):
        return (r["pose"] is not None and now-r["truth_time"]<1.5 and
                r["control"].sensors_ready(now) and r["control"].operator_ready(now))

    def publish_plan(self,r):
        msg=Path(); msg.header.frame_id="world"; msg.header.stamp=self.get_clock().now().to_msg()
        for x,y in r["path"]:
            p=PoseStamped(); p.header=msg.header; p.pose.position.x=x; p.pose.position.y=y; p.pose.orientation.w=1.
            msg.poses.append(p)
        r["plan"].publish(msg)

    def plan(self,rid,now):
        r=self.robots[rid]
        peers=[p["pose"] for i,p in self.robots.items() if i!=rid and p["pose"]]
        path=self.planner.route(r["pose"],r["goal"],peers)
        blockers=self.reservations.acquire(rid,route_zones(path)) if path else ["occupied_or_unreachable"]
        if blockers:
            r["waiting_on"]=blockers; r["state"]="waiting"
            # Retry an alternative around all zones held by other routes.
            held=set().union(*(z for owner,z in self.reservations.routes.items() if owner!=rid))
            forbidden={self.planner.cell((ix*.5,iy*.5)) for ix,iy in held}
            # Expand tiles to planner cells, retaining tile edges conservatively.
            forbidden={ (x+dx,y+dy) for x,y in forbidden for dx in (-1,0,1,2) for dy in (-1,0,1,2)}
            alternate=self.planner.route(r["pose"],r["goal"],peers,forbidden) if held else []
            if not alternate or self.reservations.acquire(rid,route_zones(alternate)):
                r["retry"]=now+2.; return
            path=alternate
        r["progress_pose"]=r["pose"]; r["progress_time"]=now
        r["path"]=path; r["state"]="navigating"; r["waiting_on"]=[]
        r["detail"]="Following reserved world route"; self.publish_plan(r)

    def tick(self):
        now=time.monotonic()
        poses=[r["pose"] for r in self.robots.values()]
        fresh=all(p is not None and now-r["truth_time"]<1.5 for p,r in zip(poses,self.robots.values()))
        separation=math.dist(poses[0][:2],poses[1][:2]) if fresh else 0.
        safety=not fresh or separation<2.3
        # Arrival order then robot id is deterministic; waiting requests own no zones.
        for rid,r in sorted(self.robots.items(),key=lambda item:(item[1]["requested"],item[0])):
            c=r["control"]; velocity=(0.,0.)
            if r["goal"]:
                if not self.ready(r,now) or safety:
                    self.stop(rid,"safety_stop","Stale telemetry/heartbeat or separation below 2.3 m")
                elif now-r["started"]>180 or (r["state"]=="waiting" and now-r["requested"]>30):
                    self.stop(rid,"failed","Bounded route wait/travel timeout; submit a new goal")
                else:
                    if not r["path"] and now>=r["retry"]:
                        self.plan(rid,now)
                    if r["path"] and (math.dist(r["pose"][:2],r["progress_pose"][:2])>0.15 or
                                       abs(angle(r["pose"][2]-r["progress_pose"][2]))>0.15):
                        r["progress_pose"]=r["pose"]; r["progress_time"]=now
                    if r["path"] and now-r["progress_time"]>8:
                        self.reservations.release(rid); r["path"]=[]; r["state"]="waiting"
                        r["detail"]="No progress; stopped for replanning"; r["retry"]=now+1.
                        self.publish_plan(r)
                    if r["path"]:
                        while len(r["path"])>1 and math.dist(r["pose"][:2],r["path"][0])<0.08:
                            r["path"].pop(0)
                        if math.dist(r["pose"][:2],r["goal"][:2])<0.1 and abs(angle(r["goal"][2]-r["pose"][2]))<0.08:
                            self.stop(rid,"succeeded","Goal reached")
                        else:
                            velocity=follow(r["pose"],r["path"][0],r["goal"][2] if len(r["path"])==1 else None)
            else:
                velocity=c.command(now)
            if safety or not c.sensors_ready(now):
                velocity=(0.,0.)
            # Manual driving must also yield before entering another reserved route.
            if c.mode=="manual" and r["pose"]:
                x,y,yaw=r["pose"]
                future=(x+velocity[0]*math.cos(yaw),y+velocity[0]*math.sin(yaw))
                sweep=route_zones([(x,y),future])
                if any(sweep & held for owner,held in self.reservations.routes.items() if owner!=rid):
                    velocity=(0.,0.)
            msg=Twist(); msg.linear.x,msg.angular.z=velocity; r["output"].publish(msg)
        state={"schema_version":1,"frame_id":"world","stamp":self.get_clock().now().nanoseconds/1e9,
               "safety_stop":safety,"separation_m":separation if fresh else None,"robots":{},"reserved_zones":{}}
        for rid,r in self.robots.items():
            status={"state":r["state"],"detail":r["detail"],"mode":r["control"].mode,
                    "goal":r["goal"],"pose":r["pose"],"waiting_on":r["waiting_on"],
                    "ready":self.ready(r,now),"busy":r["goal"] is not None}
            state["robots"][rid]=status
            message=String(); message.data=json.dumps(status,allow_nan=False); r["status"].publish(message)
            state["reserved_zones"][rid]=[list(z) for z in sorted(self.reservations.routes.get(rid,set()))]
        message=String(); message.data=json.dumps(state,allow_nan=False); self.state_output.publish(message)


def main(args=None):
    rclpy.init(args=args); node=FleetNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        for rid in node.robots:
            node.stop(rid,"canceled","Shutdown")
        node.destroy_node(); rclpy.shutdown()

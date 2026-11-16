"""Live Nav2 acceptance: both rack arrivals, with no rack footprint crossings."""
import json,math,time
from pathlib import Path
import rclpy
from rclpy.node import Node
from nav_msgs.msg import Odometry,Path as RosPath
from tf2_msgs.msg import TFMessage
from std_msgs.msg import String
from agv_web_bridge.simulation_node import SimulationNode,find_collision

class Verify(Node):
 def __init__(self):
  super().__init__('verify_rack_aisles');self.truth=None;self.odom=None;self.tf=None;self.status={};self.error=None;self.plans=0;self.checked=0;self.samples=[];self.latest_tf=0;self.max_x=-math.inf;self.min_x=math.inf
  config=SimulationNode._load_config(SimulationNode._default_config_path());self.zones=[o for o in SimulationNode._build_obstacles(config) if o.id.endswith('-NO-DRIVE')]
  assert len(self.zones)==8,'All rack floors must be reserved'
  self.command=self.create_publisher(String,'/agv_web/navigation_command',10);self.heartbeat=self.create_publisher(String,'/agv_web/operator_heartbeat',10)
  self.create_timer(.25,lambda:self.heartbeat.publish(String(data='alive')))
  self.create_subscription(Odometry,'/agv_web/ground_truth',self.on_truth,10)
  self.create_subscription(Odometry,'/odom',lambda m:setattr(self,'odom',m.pose.pose),10)
  self.create_subscription(TFMessage,'/tf',self.on_tf,10)
  self.create_subscription(String,'/agv_web/navigation_status',lambda m:setattr(self,'status',json.loads(m.data)),10)
  self.create_subscription(String,'/agv_web/collision_status',self.on_collision,10)
  self.create_subscription(RosPath,'/plan',self.on_plan,10)
 def on_truth(self,m):
  p=m.pose.pose;self.truth=(p.position.x,p.position.y,2*math.atan2(p.orientation.z,p.orientation.w));self.samples.append(self.truth)
  hit=find_collision(self.zones,*self.truth,.775,.53,.96)
  if hit:self.error='Physical robot entered '+hit.id
 def on_tf(self,m):
  for t in m.transforms:
   if t.header.frame_id=='map' and t.child_frame_id=='odom':self.tf=t.transform;self.latest_tf=time.monotonic()
 def on_collision(self,m):
  c=json.loads(m.data)
  if c.get('blocked') or c.get('collision'):self.error='Motion blocked by '+str(c.get('blocked_object_id'))
 def localized(self):
  a=2*math.atan2(self.tf.rotation.z,self.tf.rotation.w);p=self.odom
  return (self.tf.translation.x+math.cos(a)*p.position.x-math.sin(a)*p.position.y,self.tf.translation.y+math.sin(a)*p.position.x+math.cos(a)*p.position.y,a+2*math.atan2(p.orientation.z,p.orientation.w))
 def on_plan(self,m):
  if not self.truth or not self.tf or not self.odom or not m.poses:return
  localized=self.localized();a=self.truth[2]-localized[2];self.plans+=1
  for p in m.poses:
   dx=p.pose.position.x-localized[0];dy=p.pose.position.y-localized[1]
   x=self.truth[0]+math.cos(a)*dx-math.sin(a)*dy;y=self.truth[1]+math.sin(a)*dx+math.cos(a)*dy
   yaw=2*math.atan2(p.pose.orientation.z,p.pose.orientation.w)+a
   self.max_x=max(self.max_x,x);self.min_x=min(self.min_x,x);self.checked+=1
   hit=find_collision(self.zones,x,y,yaw,.775,.53,.96)
   if hit:self.error='Planned footprint crosses '+hit.id;return
 def wait(self,predicate,seconds):
  end=time.monotonic()+seconds
  while time.monotonic()<end:
   rclpy.spin_once(self,timeout_sec=.05)
   if self.error:raise AssertionError(self.error)
   if predicate():return
  raise TimeoutError(str(self.status))
 def goal(self,x,y,yaw):
  localized=self.localized();a=localized[2]-self.truth[2];dx=x-self.truth[0];dy=y-self.truth[1]
  payload={'action':'goal','x':localized[0]+math.cos(a)*dx-math.sin(a)*dy,'y':localized[1]+math.sin(a)*dx+math.cos(a)*dy,'yaw':yaw+a}
  self.command.publish(String(data=json.dumps(payload)));return payload

rclpy.init();node=Verify();report={'passed':False,'arrivals':[]};start=time.monotonic()
try:
 node.wait(lambda:node.truth and node.odom and node.tf and all(node.status.get(k) for k in ['server_ready','localization_ready','sensors_ready','operator_ready']),30)
 for rack,x,y,yaw in [('B2',-12,2.28,math.pi/2),('D1',-12,-6.68,-math.pi/2)]:
  goal=node.goal(x,y,yaw);print('GOAL '+rack+' '+json.dumps(goal),flush=True)
  node.wait(lambda:node.status.get('busy'),8)
  node.wait(lambda:node.status.get('state') in ['succeeded','failed','canceled'],150)
  assert node.status['state']=='succeeded',node.status
  error=math.hypot(node.truth[0]-x,node.truth[1]-y);assert error<.3,(rack,error)
  report['arrivals'].append({'rack':rack,'world_pose':node.truth,'world_error_m':error,'goal':goal});print('ARRIVED '+json.dumps(report['arrivals'][-1]),flush=True)
 assert node.plans>0 and node.checked>0
 assert node.max_x>.17 or node.min_x < -24.17,'The route must go around a rack end'
 report['passed']=True
finally:
 node.command.publish(String(data='{"action":"cancel"}'))
 report.update({'elapsed_s':time.monotonic()-start,'plans':node.plans,'planned_footprints_checked':node.checked,'max_plan_world_x':node.max_x,'min_plan_world_x':node.min_x,'error':node.error,'trajectory':node.samples})
 Path('/workspace/test_logs/rack_aisles/live-result.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='trajectory'}),flush=True);node.destroy_node();rclpy.shutdown()

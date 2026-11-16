"""Explore the known open cross aisle with guarded manual commands to build real SLAM."""
import json,math,time
from pathlib import Path
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from std_msgs.msg import String
rclpy.init();node=Node('map_open_aisles');pose=None;last=0;blocked=False
pub=node.create_publisher(Twist,'/agv_web/manual_cmd_vel',10)
def truth(m):
 global pose,last
 pose=(m.pose.pose.position.x,m.pose.pose.position.y,2*math.atan2(m.pose.pose.orientation.z,m.pose.pose.orientation.w));last=time.monotonic()
def collision(m):
 global blocked
 c=json.loads(m.data);blocked=c.get('blocked') or c.get('collision')
node.create_subscription(Odometry,'/agv_web/ground_truth',truth,10)
node.create_subscription(String,'/agv_web/collision_status',collision,10)
started=time.monotonic();waypoints=[(4.4,1.6),(4.4,-6.68),(-12,-6.68)];visited=[];samples=[]
try:
 for tx,ty in waypoints:
  while True:
   rclpy.spin_once(node,timeout_sec=.05);now=time.monotonic()
   if now-started>150:raise RuntimeError('Mapping drive timeout')
   if pose is None or now-last>1.0:
    pub.publish(Twist());continue
   if blocked:raise RuntimeError('Unexpected obstacle while mapping the open aisle')
   x,y,yaw=pose;d=math.hypot(tx-x,ty-y)
   if d<.12:pub.publish(Twist());visited.append({'target':[tx,ty],'pose':pose});print('MAPPED '+str(visited[-1]),flush=True);break
   error=math.atan2(math.sin(math.atan2(ty-y,tx-x)-yaw),math.cos(math.atan2(ty-y,tx-x)-yaw))
   cmd=Twist();cmd.angular.z=max(-.8,min(.8,error*2));cmd.linear.x=min(.7,d*.7) if abs(error)<.15 else 0.;pub.publish(cmd)
   samples.append({'x':x,'y':y,'yaw':yaw});time.sleep(.05)
finally:
 pub.publish(Twist());Path('/workspace/test_logs/rack_aisles/mapping-drive.json').write_text(json.dumps({'visited':visited,'samples':samples},indent=2));node.destroy_node();rclpy.shutdown()

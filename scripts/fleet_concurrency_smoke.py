"""Commands the LIVE compose domain. Run only for explicitly authorized acceptance."""
import json,math,time,sys
from pathlib import Path
from summarize_fleet_smoke import summarize
import rclpy
from std_msgs.msg import String
from geometry_msgs.msg import Twist
from nav_msgs.msg import Path as RosPath
from agv_web_bridge.fleet import GridPlanner
from agv_web_bridge.simulation_node import SimulationNode
rclpy.init(); node=rclpy.create_node('rolling_live_acceptance')
ids=('agv1','agv2'); state=None; velocities={}; collisions=[]; plans={}; start=time.monotonic()
planner=GridPlanner(SimulationNode._build_obstacles(SimulationNode._load_config(SimulationNode._default_config_path())))
heart={i:node.create_publisher(String,f'/{i}/agv_web/operator_heartbeat',10) for i in ids}
commands={i:node.create_publisher(String,f'/{i}/agv_web/navigation_command',10) for i in ids}
def fleet(msg):
 global state
 state=json.loads(msg.data)
node.create_subscription(String,'/fleet/state',fleet,10)
def collision(i,msg):
 data=json.loads(msg.data)
 if data.get('collision') or data.get('blocked'): collisions.append({'robot':i,'t':time.monotonic()-start,'report':data})
for i in ids:
 node.create_subscription(Twist,f'/{i}/cmd_vel',lambda m,i=i:velocities.update({i:(m.linear.x,m.angular.z)}),10)
 node.create_subscription(String,f'/{i}/agv_web/collision_status',lambda m,i=i:collision(i,m),10)
 node.create_subscription(RosPath,f'/{i}/plan',lambda m,i=i:plans.update({i:[(p.pose.position.x,p.pose.position.y) for p in m.poses]}),10)
def spin(seconds):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  for pub in heart.values(): pub.publish(String(data='alive'))
  rclpy.spin_once(node,timeout_sec=.02)
def run(name,goals,limit=175):
 spin(.5); before={i:state['robots'][i]['pose'] for i in ids}; initial_collisions=len(collisions)
 initial_replans={i:state['robots'][i].get('replans',0) for i in ids}
 result={'name':name,'start_poses':before,'goals':goals,'timeline':[],'baseline':{}}
 for i in ids:
  raw=planner.route(before[i],goals[i],smooth=False); smooth=planner.route(before[i],goals[i])
  length=lambda p:sum(math.dist(a,b) for a,b in zip(p,p[1:]))
  result['baseline'][i]={'straight_line_m':math.dist(before[i][:2],goals[i][:2]),'previous_grid_m':length(raw),'static_smoothed_m':length(smooth)}
  commands[i].publish(String(data=json.dumps(dict(action='goal',x=goals[i][0],y=goals[i][1],yaw=goals[i][2],request_id=name+i))))
 t0=time.monotonic(); last=t0; previous=dict(before); metrics={i:dict(distance_m=0.,waiting_s=0.,moving_s=0.,in_place_rotations=0,max_heading_rate_rad_s=0.) for i in ids}; turning={i:False for i in ids}; concurrent=0.; own_progress=0.; yielding_motion=0.; minimum=1000.
 while time.monotonic()-t0<limit:
  spin(.2); now=time.monotonic(); dt=now-last; last=now
  if state.get('separation_m') is not None: minimum=min(minimum,state['separation_m'])
  relative=[previous[ids[0]][j]-previous[ids[1]][j] for j in (0,1)]
  delta=[state['robots'][ids[0]]['pose'][j]-state['robots'][ids[1]]['pose'][j]-relative[j] for j in (0,1)]
  norm=sum(x*x for x in delta); t=max(0.,min(1.,-sum(a*b for a,b in zip(relative,delta))/norm)) if norm else 0.
  minimum=min(minimum,math.hypot(*(a+t*b for a,b in zip(relative,delta))))
  progressing=[]; yielding=False
  moving=[]; row={'t':round(now-t0,3),'separation_m':state['separation_m'],'robots':{}}
  for i in ids:
   r=state['robots'][i]; pose=r['pose']; v,w=velocities.get(i,(0.,0.)); m=metrics[i]
   dist=math.dist(previous[i][:2],pose[:2]); m['distance_m']+=dist
   rate=abs(math.atan2(math.sin(pose[2]-previous[i][2]),math.cos(pose[2]-previous[i][2])))/dt
   m['max_heading_rate_rad_s']=max(m['max_heading_rate_rad_s'],rate)
   move=dist/dt>.025; moving.append(move)
   progressing.append(move and not r.get('yielding') and math.dist(pose[:2],goals[i][:2])<math.dist(previous[i][:2],goals[i][:2]))
   yielding=yielding or (move and (r.get('yielding',False) or math.dist(pose[:2],goals[i][:2])>math.dist(previous[i][:2],goals[i][:2])))
   if move: m['moving_s']+=dt
   elif r['busy'] and abs(w)<.05: m['waiting_s']+=dt
   rotate=abs(v)<.01 and abs(w)>.1
   if rotate and not turning[i]: m['in_place_rotations']+=1
   turning[i]=rotate; previous[i]=pose
   row['robots'][i]={'state':r['state'],'detail':r['detail'],'pose':pose,'v':v,'w':w,'replans':r.get('replans',0),'yielding':r.get('yielding',False)}
  if all(moving): concurrent+=dt
  if all(progressing): own_progress+=dt
  if yielding: yielding_motion+=dt
  result['timeline'].append(row)
  if now-t0>2 and all(not r['busy'] for r in state['robots'].values()): break
 result['accepted_plans']={i:state['robots'][i].get('replans',0)-initial_replans[i] for i in ids}
 result.update(duration_s=time.monotonic()-t0,metrics=metrics,concurrent_motion_s=concurrent,both_progressing_to_own_goals_s=own_progress,yielding_or_retreating_s=yielding_motion,min_separation_m=minimum,collisions=collisions[initial_collisions:],collision_count=len(collisions)-initial_collisions,final={i:state['robots'][i] for i in ids})
 summarize(result)
 result['passed']=all(r['state']=='succeeded' for r in result['final'].values()) and (concurrent>0 or name.endswith("_staging")) and minimum>=3 and result['collision_count']==0
 for pub in commands.values(): pub.publish(String(data=json.dumps({'action':'cancel'})))
 spin(.5)
 print(json.dumps({k:v for k,v in result.items() if k!='timeline'}),flush=True)
 return result
def close_approach():
 x,y=state['robots']['agv1']['pose'][:2]
 preparation=run('close_staging',{'agv1':(x,y,0),'agv2':(x+3.8,y,math.pi)})
 pubs={i:node.create_publisher(Twist,f'/{i}/agv_web/manual_cmd_vel',10) for i in ids}
 spin(.5); timeline=[]; latched=False; cleared=False; minimum=100.; band=False; t0=time.monotonic(); initial=len(collisions)
 while time.monotonic()-t0<25:
  sep=state['separation_m']; minimum=min(minimum,sep); band=band or 3.0<=sep<=3.3
  latched=latched or state['safety_stop']
  msg=Twist(); msg.linear.x=-.2 if latched else .15
  pubs['agv2'].publish(msg); spin(.05)
  timeline.append(dict(t=time.monotonic()-t0,separation_m=state['separation_m'],safety_stop=state['safety_stop'],pose=state['robots']['agv2']['pose']))
  if latched and not state['safety_stop'] and state['separation_m']>=3.3:
   cleared=True; break
 pubs['agv2'].publish(Twist()); spin(.2)
 return dict(name='close_approach',preparation=preparation,timeline=timeline,min_separation_m=minimum,entered_3_to_3_3_band=band,latched=latched,cleared_by_manual_retreat=cleared,collision_count=len(collisions)-initial,passed=band and latched and cleared and len(collisions)==initial)

out={'domain':72,'source':'live compose ROS topics; interpolated minimum of relative truth samples','scenarios':[]}
try:
 spin(3)
 if state is None: raise RuntimeError('no live fleet')
 out['scenarios'].append(run('head_on_same_aisle',{'agv1':(8,1.6,0),'agv2':(-5,1.6,math.pi)}))
 out['preparation']=run('crossing_staging',{'agv1':(-5,1.6,0),'agv2':(5,-5,math.pi/2)})
 out['scenarios'].append(run('crossing',{'agv1':(10,1.6,0),'agv2':(5,8,math.pi/2)}))
 out['scenarios'].append(close_approach())
finally:
 for pub in commands.values(): pub.publish(String(data=json.dumps({'action':'cancel'})))
 spin(.3)
 Path('/workspace/test_logs/fleet_concurrency_smoke.json').write_text(json.dumps(out,indent=2))
 node.destroy_node(); rclpy.shutdown()

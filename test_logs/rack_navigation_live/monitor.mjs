import fs from 'node:fs';
const report={passed:false,startedAt:new Date().toISOString(),goals:[],transitions:[],blocked:[],plans:0,arrivals:[],maxTfGapMs:0};
const ws=new WebSocket('ws://localhost:9090');let truth=null, tf=null, odom=null, lastTf=0, lastStatus='', lastPrint=0, done=false;
const file=new URL('./result.json',import.meta.url);
function finish(reason){if(done)return;done=true;report.reason=reason;report.finishedAt=new Date().toISOString();report.finalTruth=truth;fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();clearInterval(tick);}
ws.onopen=()=>{for(const [topic,type] of Object.entries({'/agv_web/navigation_status':'std_msgs/msg/String','/agv_web/navigation_command':'std_msgs/msg/String','/agv_web/ground_truth':'nav_msgs/msg/Odometry','/agv_web/collision_status':'std_msgs/msg/String','/tf':'tf2_msgs/msg/TFMessage','/odom':'nav_msgs/msg/Odometry','/plan':'nav_msgs/msg/Path'}))ws.send(JSON.stringify({op:'subscribe',topic,type,queue_length:1,throttle_rate:0}));console.log('MONITOR_READY');};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.op!=='publish')return;const at=Date.now();
if(m.topic==='/agv_web/ground_truth')truth={x:m.msg.pose.pose.position.x,y:m.msg.pose.pose.position.y,yaw:2*Math.atan2(m.msg.pose.pose.orientation.z,m.msg.pose.pose.orientation.w)};
if(m.topic==='/odom')odom=m.msg.pose.pose;
if(m.topic==='/tf')for(const t of m.msg.transforms)if(t.header.frame_id==='map'&&t.child_frame_id==='odom'){if(lastTf)report.maxTfGapMs=Math.max(report.maxTfGapMs,at-lastTf);lastTf=at;tf=t.transform;}
if(m.topic==='/plan'&&m.msg.poses.length)report.plans++;
if(m.topic==='/agv_web/collision_status'){const c=JSON.parse(m.msg.data);if((c.collision||c.blocked)&&report.blocked.length<100)report.blocked.push({at,object:c.blocked_object_id,collision:c.collision,truth});}
if(m.topic==='/agv_web/navigation_command'){const c=JSON.parse(m.msg.data);if(c.action==='goal'){report.goals.push({...c,at,truth});console.log('GOAL '+JSON.stringify(c));}}
if(m.topic==='/agv_web/navigation_status'){const s=JSON.parse(m.msg.data);if(s.state!==lastStatus){report.transitions.push({...s,at,truth});console.log('STATE '+s.state+' '+s.detail+' '+JSON.stringify(truth));lastStatus=s.state;
if(s.state==='succeeded'&&report.goals.length){const angle=2*Math.atan2(tf.rotation.z,tf.rotation.w),x=tf.translation.x+Math.cos(angle)*odom.position.x-Math.sin(angle)*odom.position.y,y=tf.translation.y+Math.sin(angle)*odom.position.x+Math.cos(angle)*odom.position.y;report.arrivals.push({goal:s.goal,truth,mapErrorM:Math.hypot(x-s.goal[0],y-s.goal[1]),at});if(report.arrivals.length===2){report.passed=report.blocked.every(b=>!b.collision)&&report.arrivals.every(a=>a.mapErrorM<.3)&&report.plans>0;finish('two_goals_succeeded');}}
if(report.goals.length&&['failed','canceled','unavailable'].includes(s.state))finish(s.detail);
}if(at-lastPrint>15000){lastPrint=at;console.log('PROGRESS '+JSON.stringify({state:s.state,remaining:s.distance_remaining,truth,tfAgeMs:at-lastTf}));}}
};
const start=Date.now();const tick=setInterval(()=>{if(Date.now()-start>240000)finish('timeout');},1000);
process.on('SIGINT',()=>finish('interrupted'));

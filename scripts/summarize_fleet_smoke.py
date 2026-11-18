"""Recompute comparable metrics from truth samples, without ROS dependencies."""
import math

def summarize(result):
    if 'start_poses' not in result:
        if result.get('timeline') and 'preparation' in result:
            final=result['preparation']['final']
            anchor=final['agv1']['pose']; previous=final['agv2']['pose']; minimum=math.inf
            for row in result['timeline']:
                point=row['pose']; delta=[point[j]-previous[j] for j in (0,1)]
                relative=[previous[j]-anchor[j] for j in (0,1)]
                norm=sum(v*v for v in delta)
                t=max(0.,min(1.,-sum(a*b for a,b in zip(relative,delta))/norm)) if norm else 0.
                minimum=min(minimum,math.hypot(*(a+t*b for a,b in zip(relative,delta))))
                previous=point
            result['min_separation_m']=minimum
        return result
    ids=tuple(result['start_poses'])
    previous=result['start_poses']; last=0.; own=0.; retreat=0.; minimum=math.inf
    for row in result['timeline']:
        dt=row['t']-last; current={i:row['robots'][i]['pose'] for i in ids}
        relative=[previous[ids[0]][j]-previous[ids[1]][j] for j in (0,1)]
        delta=[current[ids[0]][j]-current[ids[1]][j]-relative[j] for j in (0,1)]
        norm=sum(v*v for v in delta)
        t=max(0.,min(1.,-sum(a*b for a,b in zip(relative,delta))/norm)) if norm else 0.
        minimum=min(minimum,math.hypot(*(a+t*b for a,b in zip(relative,delta))))
        progress=[]; yielding=False
        for i in ids:
            moving=dt>0 and math.dist(previous[i][:2],current[i][:2])/dt>.025
            before=math.dist(previous[i][:2],result['goals'][i][:2]); after=math.dist(current[i][:2],result['goals'][i][:2])
            flag=row['robots'][i].get('yielding',False)
            progress.append(moving and after<before and not flag)
            yielding=yielding or (moving and (flag or after>before))
        if all(progress): own+=dt
        if yielding: retreat+=dt
        previous=current; last=row['t']
    result.update(both_progressing_to_own_goals_s=own,yielding_or_retreating_s=retreat,min_separation_m=minimum)
    if 'final' in result:
        result['passed']=(all(r['state']=='succeeded' for r in result['final'].values()) and
                          (result.get('concurrent_motion_s',0)>0 or result['name'].endswith('_staging')) and
                          minimum>=3 and result['collision_count']==0)
    return result

if __name__=='__main__':
    import json,sys
    from pathlib import Path
    path=Path(sys.argv[1]); data=json.loads(path.read_text())
    for result in data['scenarios']:
        summarize(result)
        if 'preparation' in result: summarize(result['preparation'])
    if 'preparation' in data: summarize(data['preparation'])
    path.write_text(json.dumps(data,indent=2))

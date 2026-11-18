import type { PathPoint } from './types';

export interface RouteBox { minX: number; maxX: number; minY: number; maxY: number }
export const distance = (a: PathPoint, b: PathPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** Segment/slab intersection, including tangencies, so previews never cut corners. */
export function segmentBlocked(a: PathPoint, b: PathPoint, boxes: RouteBox[]) {
  return boxes.some((box) => {
    let low = 0, high = 1;
    for (const axis of ['x', 'y'] as const) {
      const min = axis === 'x' ? box.minX : box.minY, max = axis === 'x' ? box.maxX : box.maxY;
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-9) { if (a[axis] < min || a[axis] > max) return false; }
      else {
        const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta;
        low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
        if (low > high) return false;
      }
    }
    return true;
  });
}

/** Same .65 m tangent fillets and .08 m sampling as the fleet planner.
 * Reject arcs that enter inflated geometry; live ROS plans remain authoritative.
 */
export function smoothRoute(path: PathPoint[], boxes: RouteBox[], radius = .65, clear = (a: PathPoint, b: PathPoint) => !segmentBlocked(a,b,boxes)): PathPoint[] {
  if (path.length < 2) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1], b = path[i], c = path[i + 1];
    const ab = distance(a, b), bc = distance(b, c);
    const u = { x: (b.x-a.x)/ab, y: (b.y-a.y)/ab }, v = { x: (c.x-b.x)/bc, y: (c.y-b.y)/bc };
    const raw = Math.atan2(v.y,v.x)-Math.atan2(u.y,u.x);
    const turn = Math.atan2(Math.sin(raw),Math.cos(raw));
    const trim = radius*Math.tan(Math.abs(turn)/2);
    if (Math.abs(turn)<1e-5 || Math.abs(turn)>Math.PI-.01 || trim>Math.min(ab,bc)*.45) { out.push(b); continue; }
    const start = { x: b.x-u.x*trim, y: b.y-u.y*trim }, sign = turn>0 ? 1 : -1;
    const center = { x: start.x-sign*u.y*radius, y: start.y+sign*u.x*radius };
    const theta = Math.atan2(start.y-center.y,start.x-center.x), n = Math.max(2,Math.ceil(Math.abs(turn)*radius/.06));
    const arc = Array.from({length:n+1}, (_,j) => ({ x: center.x+radius*Math.cos(theta+turn*j/n), y: center.y+radius*Math.sin(theta+turn*j/n) }));
    const check = [out[out.length-1],...arc,c];
    if (check.slice(1).every((p,j) => clear(check[j],p))) out.push(...arc);
    else out.push(b);
  }
  out.push(path[path.length-1]);
  const sampled = [out[0]];
  for (let i=1;i<out.length;i++) {
    const a=out[i-1],b=out[i],n=Math.max(1,Math.ceil(distance(a,b)/.08));
    for (let j=1;j<=n;j++) sampled.push({x:a.x+(b.x-a.x)*j/n,y:a.y+(b.y-a.y)*j/n});
  }
  return sampled.slice(1).every((p,i)=>clear(sampled[i],p)) ? sampled : path.flatMap((b,i)=> {
    if(!i) return [b]; const a=path[i-1],n=Math.max(1,Math.ceil(distance(a,b)/.08));
    return Array.from({length:n},(_,j)=>({x:a.x+(b.x-a.x)*(j+1)/n,y:a.y+(b.y-a.y)*(j+1)/n}));
  });
}

/** Backend's conservative quarter-metre occupancy grid, exported from the
 * authoritative rack/collision geometry. Static previews use the same A*,
 * string pulling, fillet radius and sampling as the published live plans. */
import fleetGrid from './fleetGrid.json' with { type: 'json' };
const gridBlocked = new Set<string>();
for (const [row, runs] of fleetGrid.rows as [number, [number, number][]][]) {
  for (const [a,b] of runs) for (let x=a;x<=b;x++) gridBlocked.add(`${x},${row}`);
}
const cellKey = (x:number,y:number) => `${x},${y}`;
// Python round ties to even, unlike Math.round (important at rack approaches).
const roundEven = (v:number) => { const f=Math.floor(v); return v-f===.5 ? (f%2===0?f:f+1) : Math.round(v); };
const gridFree = (x:number,y:number) => x>=-124 && x<=124 && y>=-76 && y<=76 && !gridBlocked.has(cellKey(x,y));
const inBounds=(p:PathPoint)=>p.x>=-31&&p.x<=31&&p.y>=-19&&p.y<=19;
const gridClear = (a:PathPoint,b:PathPoint) => {
  if(!inBounds(a)||!inBounds(b)) return false;
  const cuts=new Set([0,1]);
  for(const axis of ['x','y'] as const){
    const lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]),delta=b[axis]-a[axis];
    if(Math.abs(delta)>1e-12) for(let k=Math.ceil(lo*4-.5);k<=Math.floor(hi*4-.5);k++) cuts.add(Math.max(0,Math.min(1,((k+.5)/4-a[axis])/delta)));
  }
  const sorted=[...cuts].sort((a,b)=>a-b);
  return [...sorted,...sorted.slice(1).map((t,i)=>(t+sorted[i])/2)].every(t=>gridFree(roundEven((a.x+(b.x-a.x)*t)*4),roundEven((a.y+(b.y-a.y)*t)*4)));
};
export function planFleetRoute(start:PathPoint,end:PathPoint):PathPoint[] {
  if (!inBounds(start)||!inBounds(end)||![start.x,start.y,end.x,end.y].every(Number.isFinite)) return [];
  const first=[roundEven(start.x*4),roundEven(start.y*4)], last=[roundEven(end.x*4),roundEven(end.y*4)];
  if(!gridFree(first[0],first[1]) || !gridFree(last[0],last[1])) return [];
  type Entry=[number,number,number];
  const heap:Entry[]=[];
  const less=(a:Entry,b:Entry)=>a[0]<b[0] || (a[0]===b[0] && (a[1]<b[1] || (a[1]===b[1] && a[2]<b[2])));
  const push=(e:Entry)=>{heap.push(e);let i=heap.length-1;while(i>0){const j=(i-1)>>1;if(!less(heap[i],heap[j]))break;[heap[i],heap[j]]=[heap[j],heap[i]];i=j;}};
  const pop=()=>{const top=heap[0],tail=heap.pop()!;if(heap.length){heap[0]=tail;let i=0;for(;;){let j=i;for(const c of [i*2+1,i*2+2])if(c<heap.length&&less(heap[c],heap[j]))j=c;if(j===i)break;[heap[i],heap[j]]=[heap[j],heap[i]];i=j;}}return top;};
  const costs=new Map([[cellKey(first[0],first[1]),0]]), previous=new Map<string,number[]>();
  push([0,first[0],first[1]]);
  while(heap.length){
    const [,x,y]=pop(), key=cellKey(x,y);
    if(x===last[0]&&y===last[1]){
      const cells=[[x,y]];
      while(cells[cells.length-1][0]!==first[0]||cells[cells.length-1][1]!==first[1]) {const c=cells[cells.length-1];cells.push(previous.get(cellKey(c[0],c[1]))!);}
      const raw=[start,...cells.reverse().map(([x,y])=>({x:x/4,y:y/4})),end].filter((p,i,all)=>i===0||distance(p,all[i-1])>0);
      const path=[raw[0]];let i=0;
      while(i<raw.length-1){let j=raw.length-1;while(j>i+1&&!gridClear(raw[i],raw[j]))j--;path.push(raw[j]);i=j;}
      return smoothRoute(path,[],.65,gridClear);
    }
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy,k=cellKey(nx,ny),cost=costs.get(key)!+1;
      if(gridFree(nx,ny)&&cost<(costs.get(k)??Infinity)){costs.set(k,cost);previous.set(k,[x,y]);push([cost+Math.abs(nx-last[0])+Math.abs(ny-last[1]),nx,ny]);}
    }
  }
  return [];
}

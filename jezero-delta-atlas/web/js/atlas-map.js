/* Jezero Delta Atlas: pan/zoom map, overlay layers (registered by atlas-shell.js), route planner UI.
   Reads window.JEZERO_CRATERS from ../data/craters-data.js (written by integration/web_bridge.py). */
(function(){
var CR=window.JEZERO_CRATERS||{craters:[]};   // set by ../data/craters-data.js; its meta also carries the map extent
var M=CR.meta||{},BB=M.bbox||{lon0:77.1,lon1:77.8,lat0:18.1,lat1:18.75},PG=M.page||[1990,1848];
var W=PG[0],H=PG[1],LON0=BB.lon0,LAT1=BB.lat1,DLON=BB.lon1-BB.lon0,DLAT=BB.lat1-BB.lat0;
// The delta outline and channel below were drawn on the first, larger map
// (77.10-77.80E, 18.10-18.75N, 1990 x 1848). o2n turns such a point into a lon/lat and then into a pixel of the current map.
function o2n(p){var lo=77.1+p[0]/1990*0.7,la=18.75-p[1]/1848*0.65;return [(lo-LON0)/DLON*W,(LAT1-la)/DLAT*H]}
function inMap(p){return p[0]>=0&&p[0]<=W&&p[1]>=0&&p[1]<=H}
var ll=function(x,y){return [LON0+x/W*DLON, LAT1-y/H*DLAT]};
var NS='http://www.w3.org/2000/svg';
var delta=[[470,735],[560,640],[700,610],[850,570],[935,600],[958,690],[950,770],[905,838],[830,858],[740,838],[670,776],[580,748]];
var chan=[[60,400],[200,380],[330,455],[430,470],[405,560],[392,640],[470,728]];
delta=delta.map(o2n);chan=chan.map(o2n);var dlab=o2n([760,725]);

var ov=document.getElementById('ov');
function el(t,a,p){var e=document.createElementNS(NS,t);for(var k in a)e.setAttribute(k,a[k]);(p||ov).appendChild(e);return e}
var L={};
// graticule
var g=L.grid=el('g');
var STEP=DLON>0.4?0.1:0.05,DEC=STEP<0.1?2:1;
for(var i=Math.ceil(LON0/STEP-1e-9);i*STEP<=LON0+DLON+1e-9;i++){var lo=i*STEP,x=(lo-LON0)/DLON*W;el('line',{x1:x,x2:x,y1:0,y2:H,stroke:'#fff','stroke-opacity':.22,'stroke-width':1,'vector-effect':'non-scaling-stroke'},g);var t=el('text',{x:x+4,y:16,class:'gt k'},g);t.textContent=lo.toFixed(DEC)+'°E'}
for(var i2=Math.ceil((LAT1-DLAT)/STEP-1e-9);i2*STEP<=LAT1+1e-9;i2++){var la=i2*STEP,y=(LAT1-la)/DLAT*H;el('line',{x1:0,x2:W,y1:y,y2:y,stroke:'#fff','stroke-opacity':.22,'stroke-width':1,'vector-effect':'non-scaling-stroke'},g);var t2=el('text',{x:4,y:y-4,class:'gt k'},g);t2.textContent=la.toFixed(DEC)+'°N'}
function pts(a){return a.map(function(p){return p.join(',')}).join(' ')}
var d=L.delta=el('g');
el('polygon',{points:pts(delta),fill:'#5ec8d8','fill-opacity':.16,stroke:'#5ec8d8','stroke-width':2.5,'stroke-dasharray':'8 5','vector-effect':'non-scaling-stroke'},d);
var dl=el('g',{transform:'translate('+dlab[0]+' '+dlab[1]+')'},d);var dk=el('g',{class:'k'},dl);var dt=el('text',{x:0,y:0,'text-anchor':'middle',style:'font-size:15px'},dk);dt.textContent='WESTERN DELTA FAN';
var ch=L.chan=el('g');
el('polyline',{points:pts(chan),fill:'none',stroke:'#7fd8ff','stroke-width':3,'stroke-opacity':.9,'vector-effect':'non-scaling-stroke'},ch);

// craters: one layer per size class, plus a layer for low-confidence marks
var CC={cL:'#ff5a44',cM:'#ffd23c',cS:'#4fd6ff',cU:'#d7d7d7'},cnt2={cL:0,cM:0,cS:0,cU:0};
['cL','cM','cS','cU'].forEach(function(k){L[k]=el('g')});
CR.craters.forEach(function(c){var k=c.confidence<0.6?'cU':c['class']==='large'?'cL':c['class']==='medium'?'cM':'cS';cnt2[k]++;
 var x=c.page[0],y=c.page[1],r=c.page[2];var gg=el('g',{class:'hit'},L[k]);
 el('circle',{cx:x,cy:y,r:r,fill:CC[k],'fill-opacity':.10,stroke:CC[k],'stroke-width':k==='cU'?1.5:2.5,'stroke-dasharray':k==='cU'?'5 4':'none','vector-effect':'non-scaling-stroke'},gg);
 el('circle',{cx:x,cy:y,r:r*0.12+2,fill:CC[k],stroke:'none',opacity:.9},gg);
 gg.addEventListener('click',function(e){e.stopPropagation();if(core.busy())return;setInfo('Crater #'+c.id,'About '+c.diameter_m+' m across ('+(k==='cU'?'low-confidence mark':c['class']+' class')+'). Detector confidence '+c.confidence.toFixed(2)+'. Rim and floor slopes are a trip and fall hazard on foot; a rim crossing may need a detour.',c.lat.toFixed(4)+'°N  '+c.lon.toFixed(4)+'°E');focus(x,y,Math.max(2.2,Math.min(6,60/r)))})});
// layer definitions: atlas-shell.js registers these through Atlas.registerLayer (it loads right after this file)
var LAYERDEFS=[
 {id:'craters-large',label:'Large craters  >700 m',group:'Hazards · detected',color:CC.cL,node:L.cL,on:true,count:cnt2.cL},
 {id:'craters-medium',label:'Medium craters  250–700 m',group:'Hazards · detected',color:CC.cM,node:L.cM,on:true,count:cnt2.cM},
 {id:'craters-small',label:'Small craters  <250 m',group:'Hazards · detected',color:CC.cS,node:L.cS,on:true,count:cnt2.cS},
 {id:'craters-low',label:'Low-confidence marks',group:'Hazards · detected',color:CC.cU,node:L.cU,on:false,count:cnt2.cU},
 {id:'delta',label:'Delta fan',group:'Reference',color:'#5ec8d8',node:L.delta,on:false},
 {id:'channel',label:'River channel',group:'Reference',color:'#7fd8ff',node:L.chan,on:false},
 {id:'grid',label:'Lat / lon grid',group:'Reference',color:'#999999',node:L.grid,on:false}];
LAYERDEFS.forEach(function(l){l.node.style.display=l.on?'':'none'});
function mk(t,x,c){var e=document.createElement(t);if(x!==undefined&&x!=='')e.textContent=x;if(c)e.className=c;return e}
var info=document.getElementById('info');var ncr=document.getElementById('ncr');if(ncr)ncr.textContent=CR.craters.length;
function setInfo(h,p,m){if(core.onInfo)core.onInfo();info.innerHTML='<h2>Selected</h2><h3></h3><p></p><div class="meta"></div>';info.querySelector('h3').textContent=h;info.querySelector('p').textContent=p;info.querySelector('.meta').textContent=m}
function fmt(x,y){var q=ll(x,y);return q[1].toFixed(4)+'°N  '+q[0].toFixed(4)+'°E'}

// pan / zoom
var map=document.getElementById('map'),stage=document.getElementById('stage');
var v={s:1,x:0,y:0},base=1,viewSubs=[],pad={l:0,r:0,t:0,b:0};   // viewSubs: functions called after every pan / zoom (Atlas.onView)
function fit(){var r=map.getBoundingClientRect();base=Math.max(r.width/W,r.height/H);stage.style.width=W+'px';stage.style.height=H+'px';v.s=1;var k=base;v.x=(r.width-W*k)/2;v.y=(r.height-H*k)/2;apply()}
function apply(clamp){var r=map.getBoundingClientRect(),k=base*v.s;
 v.x=Math.min(pad.l,Math.max(r.width-W*k-pad.r,v.x));v.y=Math.min(pad.t,Math.max(r.height-H*k-pad.b,v.y));
 stage.style.transform='translate('+v.x+'px,'+v.y+'px) scale('+k+')';stage.style.setProperty('--inv',1/k);
 viewSubs.forEach(function(f){try{f()}catch(e){if(window.console)console.error(e)}});
 var m=(DLON*59.27*Math.cos(18.4*Math.PI/180)*1000)/W;var tgt=[100,200,500,1000,2000,5000,10000].reduce(function(a,b){return b*1/(m)*k<=140?b:a},100);
 document.getElementById('sb').style.width=(tgt/m*k)+'px';document.getElementById('sl').textContent=(tgt>=1000?tgt/1000+' km':tgt+' m')}
function zoomAt(cx,cy,f){var r=map.getBoundingClientRect(),k0=base*v.s,s2=Math.min(12,Math.max(1,v.s*f));if(s2===v.s)return;var k1=base*s2;
 var px=(cx-v.x)/k0,py=(cy-v.y)/k0;v.s=s2;v.x=cx-px*k1;v.y=cy-py*k1;apply()}
function focus(x,y,s){var r=map.getBoundingClientRect();stage.classList.add('ease');v.s=Math.max(v.s,s);var k=base*v.s;v.x=r.width/2-x*k;v.y=r.height/2-y*k;apply();setTimeout(function(){stage.classList.remove('ease')},520)}
/* focusAt: like focus, but the page point ends up at screen point (sx,sy) of the map box instead of its centre (used to keep a pin clear of a card) */
function focusAt(x,y,s,sx,sy){var r=map.getBoundingClientRect();stage.classList.add('ease');v.s=Math.max(v.s,s);var k=base*v.s;v.x=sx-x*k;v.y=sy-y*k;apply();setTimeout(function(){stage.classList.remove('ease')},520)}
function setPad(l,r,t,b){pad={l:l||0,r:r||0,t:t||0,b:b||0};stage.classList.add('ease');apply();setTimeout(function(){stage.classList.remove('ease')},520)}   // extra pan range, so a point near the map edge can still be brought clear of a card
function view(){var r=map.getBoundingClientRect(),k=base*v.s;return {k:k,x:v.x,y:v.y,w:r.width,h:r.height,left:r.left,top:r.top}}
map.addEventListener('wheel',function(e){e.preventDefault();var r=map.getBoundingClientRect();zoomAt(e.clientX-r.left,e.clientY-r.top,e.deltaY<0?1.25:0.8)},{passive:false});
var ptrs={},last=null,pd=0,clickDown=null,core={busy:function(){return false}};
map.addEventListener('pointerdown',function(e){if(e.target.closest('.tools,.inset,.ui'))return;map.setPointerCapture(e.pointerId);ptrs[e.pointerId]=[e.clientX,e.clientY];map.classList.add('drag');var a=Object.keys(ptrs);if(a.length===2){var p=ptrs[a[0]],q=ptrs[a[1]];pd=Math.hypot(p[0]-q[0],p[1]-q[1])}});
map.addEventListener('pointermove',function(e){var r=map.getBoundingClientRect(),q=ll((e.clientX-r.left-v.x)/(base*v.s),(e.clientY-r.top-v.y)/(base*v.s));document.getElementById('ll').textContent=q[1].toFixed(4)+'°N  '+q[0].toFixed(4)+'°E';
 if(!ptrs[e.pointerId])return;var a=Object.keys(ptrs),o=ptrs[e.pointerId];
 if(a.length===2){ptrs[e.pointerId]=[e.clientX,e.clientY];var p=ptrs[a[0]],q2=ptrs[a[1]],dd=Math.hypot(p[0]-q2[0],p[1]-q2[1]);if(pd)zoomAt((p[0]+q2[0])/2-r.left,(p[1]+q2[1])/2-r.top,dd/pd);pd=dd}
 else{v.x+=e.clientX-o[0];v.y+=e.clientY-o[1];ptrs[e.pointerId]=[e.clientX,e.clientY];apply()}});
function up(e){delete ptrs[e.pointerId];pd=0;if(!Object.keys(ptrs).length)map.classList.remove('drag')}
map.addEventListener('pointerdown',function(e){clickDown=[e.clientX,e.clientY]},true);
map.addEventListener('pointerup',function(e){var d=clickDown;clickDown=null;if(!d||!core.onClick||Math.hypot(e.clientX-d[0],e.clientY-d[1])>5||e.target.closest('.tools,.inset,.ui'))return;
 var r=map.getBoundingClientRect(),k=base*v.s,x=(e.clientX-r.left-v.x)/k,y=(e.clientY-r.top-v.y)/k;if(x<0||y<0||x>W||y>H)return;core.onClick({x:x,y:y,event:e})});
map.addEventListener('pointerup',up);map.addEventListener('pointercancel',up);
document.getElementById('zi').onclick=function(){var r=map.getBoundingClientRect();zoomAt(r.width/2,r.height/2,1.5)};
document.getElementById('zo').onclick=function(){var r=map.getBoundingClientRect();zoomAt(r.width/2,r.height/2,1/1.5)};
document.getElementById('zr').onclick=fit;
window.addEventListener('resize',fit);
/* Route planner UI: click a start and a destination, A* (route-planner.js) draws the fastest safe route. */
(function(){
var rt={on:false,start:null,goal:null,grid:null},plan=L.plan=el('g');
var go=document.getElementById('rt-go'),clr=document.getElementById('rt-clear'),out=document.getElementById('rt-out'),help=document.getElementById('rt-help'),spd=document.getElementById('rt-speed');
function fmtPos(p){var q=ll(p[0],p[1]);return q[1].toFixed(4)+'°N, '+q[0].toFixed(4)+'°E'}
function fmtDist(m){return m>=1000?(m/1000).toFixed(2)+' km':Math.round(m)+' m'}
function fmtTime(s){var m=Math.round(s/60);if(m<60)return m+' min';var h=Math.floor(m/60);return h+' h '+(m%60)+' min'}
function marker(p,color,label){var g=el('g',{transform:'translate('+p[0]+' '+p[1]+')'},plan),k=el('g',{class:'k'},g);el('circle',{r:7,fill:color,stroke:'#000','stroke-width':2},k);var t=el('text',{x:11,y:5},k);t.textContent=label}
function say(text,err){out.textContent='';var d=document.createElement('div');if(err)d.className='err';d.textContent=text;out.appendChild(d)}
function draw(){while(plan.firstChild)plan.removeChild(plan.firstChild);
 if(rt.route){var pts=rt.route.points.map(function(p){return p.join(',')}).join(' ');
  el('polyline',{points:pts,fill:'none',stroke:'#000','stroke-width':7,'stroke-linejoin':'round','stroke-linecap':'round','vector-effect':'non-scaling-stroke'},plan);
  el('polyline',{points:pts,fill:'none',stroke:'#ff4fd8','stroke-width':4,'stroke-linejoin':'round','stroke-linecap':'round','vector-effect':'non-scaling-stroke'},plan)}
 if(rt.start)marker(rt.start,'#7CFC00','Start');if(rt.goal)marker(rt.goal,'#ff4fd8','Destination')}
var HELP0='Find the fastest safe route between two points, avoiding detected craters.';
function arm(label){window.Atlas.pick({owner:'route',label:label,onCancel:function(){if(rt.on){reset(false);say('');help.textContent=HELP0}}},onPick);try{map.focus({preventScroll:true})}catch(e){}}
function onPick(ev){var p=[ev.x,ev.y];if(!rt.start){rt.start=p;draw();help.textContent='Now click the destination.';say('Start set: '+fmtPos(p));arm('route destination')}else{rt.goal=p;draw();solve()}}
function reset(keepMode){if(!keepMode&&rt.on&&window.Atlas&&window.Atlas.picking&&window.Atlas.picking()==='route'){rt.on=false;window.Atlas.pick.cancel('route')}rt.start=rt.goal=rt.route=null;rt.on=!!keepMode;go.classList.toggle('on',rt.on);go.textContent=rt.on?'Cancel':'Pick start and destination';draw()}
function solve(){var speed=parseFloat(spd.value);
 if(!rt.grid)rt.grid=window.RoutePlanner.buildGrid(CR.craters,CR.meta);
 var res=Math.hypot(rt.goal[0]-rt.start[0],rt.goal[1]-rt.start[1])<2?{error:'Start and destination are the same point. Pick a different destination.'}:window.RoutePlanner.plan(rt.grid,rt.start,rt.goal,speed);
 if(res.error){rt.goal=null;draw();say(res.error,true);help.textContent='Click another destination.';rt.on=true;arm('route destination');return}
 rt.route=res;rt.on=false;go.classList.remove('on');go.textContent='Pick new points';draw();
 var extra=Math.round((res.distance_m/res.straight_m-1)*100);
 out.textContent='';[['Route',fmtDist(res.distance_m)+(extra>0?' (+'+extra+'% over the straight line, '+fmtDist(res.straight_m)+')':'')],['Time',fmtTime(res.time_s)],['From',fmtPos(rt.start)],['To',fmtPos(rt.goal)]].forEach(function(r){var d=document.createElement('div'),b=document.createElement('b');b.textContent=r[0]+': ';d.appendChild(b);d.appendChild(document.createTextNode(r[1]));out.appendChild(d)});
 help.textContent='Craters with detector confidence 0.6 or higher are avoided. Slope and rocks are not modelled.'}
go.onclick=function(){if(rt.on){reset(false);say('');help.textContent='Find the fastest safe route between two points, avoiding detected craters.';return}reset(true);say('');help.textContent='Click the map to set the start.';arm('route start')};
clr.onclick=function(){reset(false);say('');help.textContent='Find the fastest safe route between two points, avoiding detected craters.'};
// "Travel by": options come from data/travel-speeds.js (rover first, so it is the default); nothing is hard-coded here
var SP=window.JEZERO_SPEEDS||{rover:{label:'Pressurised rover',mps:2.8},foot:{label:'Astronaut on foot',mps:1.4}};
['rover','foot'].forEach(function(k){if(!SP[k])return;var o=document.createElement('option');o.value=String(SP[k].mps);o.textContent=SP[k].label+', '+SP[k].mps+' m/s (about '+Math.round(SP[k].mps*3.6)+' km/h)';spd.appendChild(o)});
spd.onchange=function(){if(rt.route)solve()};
})();
/* Keyboard access: arrow keys pan, + / - zoom, 0 resets (map must be focused). */
map.addEventListener('keydown',function(e){if(e.target!==map)return;var r=map.getBoundingClientRect(),st=60,h=true;
 if(e.key==='ArrowLeft')v.x+=st;else if(e.key==='ArrowRight')v.x-=st;else if(e.key==='ArrowUp')v.y+=st;else if(e.key==='ArrowDown')v.y-=st;
 else if(e.key==='+'||e.key==='=')zoomAt(r.width/2,r.height/2,1.5);else if(e.key==='-'||e.key==='_')zoomAt(r.width/2,r.height/2,1/1.5);
 else if(e.key==='0')fit();
 else if((e.key==='Enter'||e.key===' ')&&core.busy()&&core.onClick){var k=base*v.s;core.onClick({x:(r.width/2-v.x)/k,y:(r.height/2-v.y)/k,event:e})}   // keyboard: while a map pick is active, Enter takes the centre of the view
 else h=false;
 if(h){e.preventDefault();apply()}});
fit();
// what atlas-shell.js needs to build window.Atlas (see docs/ARCHITECTURE.md)
var MS=window.JEZERO_MISSION||{base:{x:W-24,y:H/2},stops:[]};   // data/mission-data.js: base camp and the 5 stops (page px)
core.W=W;core.H=H;core.ll=ll;core.xy=function(lon,lat){return [(lon-LON0)/DLON*W,(LAT1-lat)/DLAT*H]};
core.el=el;core.setInfo=setInfo;core.focus=focus;core.focusAt=focusAt;core.view=view;core.setPad=setPad;core.onView=function(f){if(typeof f==='function')viewSubs.push(f)};core.layers=LAYERDEFS;core.map=map;core.stage=stage;core.fit=fit;
core.mapData={base:{id:'base',name:MS.base.name,x:MS.base.x,y:MS.base.y},stops:MS.stops.map(function(s){return {id:s.id,n:s.n,name:s.name,x:s.x,y:s.y}})};
core.landing=[MS.base.x,MS.base.y];   // page px of base camp (it replaces the old landing site and lies inside the map)
window.AtlasMapCore=core;
})();

/* Jezero Delta Atlas: pan/zoom map, overlay layers, layers checklist menu, sample list.
   Reads window.JEZERO_CRATERS from ../data/craters-data.js (written by integration/web_bridge.py). */
(function(){
var CR=window.JEZERO_CRATERS||{craters:[]};   // set by ../data/craters-data.js; its meta also carries the map extent
var M=CR.meta||{},BB=M.bbox||{lon0:77.1,lon1:77.8,lat0:18.1,lat1:18.75},PG=M.page||[1990,1848];
var W=PG[0],H=PG[1],LON0=BB.lon0,LAT1=BB.lat1,DLON=BB.lon1-BB.lon0,DLAT=BB.lat1-BB.lat0;
// The place names, sample clusters, delta outline, channel and route below were drawn on the first, larger map
// (77.10-77.80E, 18.10-18.75N, 1990 x 1848). o2n turns such a point into a lon/lat and then into a pixel of the current map.
function o2n(p){var lo=77.1+p[0]/1990*0.7,la=18.75-p[1]/1848*0.65;return [(lo-LON0)/DLON*W,(LAT1-la)/DLAT*H]}
function inMap(p){return p[0]>=0&&p[0]<=W&&p[1]>=0&&p[1]<=H}
var ll=function(x,y){return [LON0+x/W*DLON, LAT1-y/H*DLAT]};
var NS='http://www.w3.org/2000/svg';
var C={ig:'var(--igneous)',sed:'var(--sed)',fan:'var(--fan)',mar:'var(--margin)'};
var areas={
 'Polygon Valley':[1040,925],'Artuby Ridge':[950,1010],'South Séítah':[860,985],
 "Octavia E. Butler Landing / Ch'ał outcrop":[1005,868],'Delta Front':[915,815],'Upper Fan':[700,655],
 'Margin Unit':[540,960],'Neretva Vallis':[430,540],'Crater Rim (Witch Hazel Hill)':[455,1020],'Crater Rim (Krokodillen)':[360,880]};
var S=[
[1,'Roubion','Roubion','Polygon Valley','Atmospheric',164,'6 Aug 2021'],
[2,'Montdenier','Rochette','Artuby Ridge','Igneous',194,'6 Sep 2021'],
[3,'Montagnac','Rochette','Artuby Ridge','Igneous',196,'8 Sep 2021'],
[4,'Salette','Brac','South Séítah','Igneous',262,'15 Nov 2021'],
[5,'Coulettes','Brac','South Séítah','Igneous',271,'24 Nov 2021'],
[6,'Robine','Issole','South Séítah','Igneous',298,'22 Dec 2021'],
[7,'Malay','Issole','South Séítah','Igneous',337,'31 Jan 2022'],
[8,"Ha'ahóni",'Sid',"Octavia E. Butler Landing / Ch'ał outcrop",'Igneous',371,'7 Mar 2022'],
[9,'Atsá','Sid',"Octavia E. Butler Landing / Ch'ał outcrop",'Igneous',377,'13 Mar 2022'],
[10,'Swift Run','Skinner Ridge','Delta Front','Sedimentary',490,'7 Jul 2022'],
[11,'Skyland','Skinner Ridge','Delta Front','Sedimentary',495,'12 Jul 2022'],
[12,'Hazeltop','Wildcat Ridge','Delta Front','Sedimentary',509,'27 Jul 2022'],
[13,'Bearwallow','Wildcat Ridge','Delta Front','Sedimentary',516,'3 Aug 2022'],
[14,'Shuyak','Amalik','Delta Front','Sedimentary',575,'2 Oct 2022'],
[15,'Mageik','Amalik','Delta Front','Sedimentary',619,'16 Nov 2022'],
[16,'Kukaklek','Hidden Harbor','Delta Front','Sedimentary',631,'29 Nov 2022'],
[17,'Atmo Mountain','Observation Mountain','Delta Front','Regolith',634,'2 Dec 2022'],
[18,'Crosswind Lake','Observation Mountain','Delta Front','Regolith',639,'7 Dec 2022'],
[19,'Melyn','Berea','Upper Fan','Sedimentary',749,'30 Mar 2023'],
[20,'Otis Peak','Emerald Lake','Upper Fan','Sedimentary',832,'23 Jun 2023'],
[21,'Pilot Mountain','Dream Lake','Upper Fan','Sedimentary',913,'15 Sep 2023'],
[22,'Pelican Point','Hans Amundsen Memorial Workspace','Margin Unit','Sedimentary',923,'25 Sep 2023'],
[23,'Lefroy Bay','Turquoise Bay','Margin Unit','Sedimentary',949,'21 Oct 2023'],
[24,'Comet Geyser','Bunsen Peak','Margin Unit','Silica-cemented carbonate',1088,'12 Mar 2024'],
[25,'Sapphire Canyon','Cheyava Falls','Neretva Vallis','Sedimentary',1215,'21 Jul 2024'],
[26,'Silver Mountain','Shallow Bay','Crater Rim (Witch Hazel Hill)','Igneous / impactite',1401,'28 Jan 2025'],
[27,'Green Gardens','Tablelands','Crater Rim (Witch Hazel Hill)','Serpentinite',1433,'2 Mar 2025'],
[28,'Main River','Broom Point','Crater Rim (Witch Hazel Hill)','Igneous / impactite',1441,'10 Mar 2025']];
function col(s){var a=s[3];if(a==='Upper Fan')return C.fan;if(a==='Margin Unit'||a==='Neretva Vallis'||a.indexOf('Rim')===0)return C.mar;if(s[4].indexOf('Sedimentary')===0||s[4]==='Regolith')return C.sed;return C.ig}
var cnt={};S.forEach(function(s){var n=cnt[s[3]]=(cnt[s[3]]||0)+1;var b=o2n(areas[s[3]]),ang=n*2.4+s[0],r=10+n*5;s.x=b[0]+Math.cos(ang)*r;s.y=b[1]+Math.sin(ang)*r;s.off=!inMap([s.x,s.y])});
var nOn=S.filter(function(s){return !s.off}).length;
var F=[
 {id:'landing',n:'Octavia E. Butler Landing',x:998,y:868,d:'Landing site of Perseverance, 18 February 2021. Coordinates 18.4446°N, 77.4509°E.'},
 {id:'hawks',n:'Hawksbill Gap',x:850,y:772,d:'Gap in the delta front that the rover climbed in 2022 to reach the top of the delta. Position approximate.'},
 {id:'three',n:'Three Forks',x:932,y:862,d:'Staging area where three route options to the delta merge, used to start the Delta Front campaign. Position approximate.'},
 {id:'neretva',n:'Neretva Vallis',x:430,y:470,d:'Ancient river channel that fed the delta from the west. Cheyava Falls, the sample 25 target, lies along it.'},
 {id:'whh',n:'Witch Hazel Hill',x:455,y:1005,d:'Stop on the crater rim, where serpentinite and impact-related rocks were sampled in 2025. Position approximate.'},
 {id:'seitah',n:'Séítah',x:890,y:975,d:'Crater-floor unit of igneous rock sampled in 2021 and early 2022. Position approximate.'}];
F=F.map(function(f){var p=o2n([f.x,f.y]);f.x=p[0];f.y=p[1];return f}).filter(function(f){return inMap([f.x,f.y])});
var delta=[[470,735],[560,640],[700,610],[850,570],[935,600],[958,690],[950,770],[905,838],[830,858],[740,838],[670,776],[580,748]];
var chan=[[60,400],[200,380],[330,455],[430,470],[405,560],[392,640],[470,728]];
var route=[[998,868],[940,985],[880,985],[950,905],[932,862],[850,772],[780,702],[700,655],[560,700],[470,730],[430,545],[470,800],[455,1005]];
delta=delta.map(o2n);chan=chan.map(o2n);route=route.map(o2n);var dlab=o2n([760,725]);

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
var rt=L.route=el('g');
el('polyline',{points:pts(route),fill:'none',stroke:'#ffb347','stroke-width':3,'stroke-dasharray':'2 7','stroke-linecap':'round','vector-effect':'non-scaling-stroke'},rt);
var sm=L.samples=el('g');
var smEls=[];
S.forEach(function(s,i){if(s.off){smEls.push(null);return}var gg=el('g',{transform:'translate('+s.x+' '+s.y+')',class:'hit','data-i':i},sm);var k=el('g',{class:'k'},gg);el('circle',{r:6,fill:col(s),stroke:'#000','stroke-width':1.5},k);el('circle',{r:13,fill:'transparent'},k);var t=el('text',{x:9,y:4,class:'lab',style:'font-size:10px'},k);t.textContent=s[0];smEls.push(gg);gg.addEventListener('click',function(e){e.stopPropagation();pickSample(i)})});
var ft=L.features=el('g');
F.forEach(function(f){var gg=el('g',{transform:'translate('+f.x+' '+f.y+')',class:'hit'},ft);var k=el('g',{class:'k'},gg);
 if(f.id==='landing'){el('path',{d:'M0,-12 L3.5,-4 12,-4 5,2 7.5,11 0,5.5 -7.5,11 -5,2 -12,-4 -3.5,-4Z',fill:'#fff',stroke:'#000','stroke-width':1.5},k)}
 else{el('rect',{x:-6,y:-6,width:12,height:12,transform:'rotate(45)',fill:'#fff',stroke:'#000','stroke-width':1.5},k)}
 el('circle',{r:16,fill:'transparent'},k);var t=el('text',{x:15,y:5},k);t.textContent=f.n;gg.addEventListener('click',function(e){e.stopPropagation();pickFeature(f)})});

// craters: one layer per size class, plus a layer for low-confidence marks
var CC={cL:'#ff5a44',cM:'#ffd23c',cS:'#4fd6ff',cU:'#d7d7d7'},cnt2={cL:0,cM:0,cS:0,cU:0};
['cL','cM','cS','cU'].forEach(function(k){L[k]=el('g')});
CR.craters.forEach(function(c){var k=c.confidence<0.6?'cU':c['class']==='large'?'cL':c['class']==='medium'?'cM':'cS';cnt2[k]++;
 var x=c.page[0],y=c.page[1],r=c.page[2];var gg=el('g',{class:'hit'},L[k]);
 el('circle',{cx:x,cy:y,r:r,fill:CC[k],'fill-opacity':.10,stroke:CC[k],'stroke-width':k==='cU'?1.5:2.5,'stroke-dasharray':k==='cU'?'5 4':'none','vector-effect':'non-scaling-stroke'},gg);
 el('circle',{cx:x,cy:y,r:r*0.12+2,fill:CC[k],stroke:'none',opacity:.9},gg);
 gg.addEventListener('click',function(e){e.stopPropagation();setInfo('Crater #'+c.id,'About '+c.diameter_m+' m across ('+(k==='cU'?'low-confidence mark':c['class']+' class')+'). Detector confidence '+c.confidence.toFixed(2)+'. Rim and floor slopes are a trip and fall hazard on foot; a rim crossing may need a detour.',c.lat.toFixed(4)+'°N  '+c.lon.toFixed(4)+'°E');focus(x,y,Math.max(2.2,Math.min(6,60/r)))})});
// checklist menu
var menu=document.getElementById('menu'),mb=document.getElementById('mb');
var GROUPS=[['Hazards · detected',[['cL','Large craters  >700 m',CC.cL,cnt2.cL,1],['cM','Medium craters  250–700 m',CC.cM,cnt2.cM,1],['cS','Small craters  <250 m',CC.cS,cnt2.cS,1],['cU','Low-confidence marks',CC.cU,cnt2.cU,0]]],
 ['Reference',[['delta','Delta fan','#5ec8d8','',0],['chan','Neretva Vallis channel','#7fd8ff','',0],['route','Rover route','#ffb347','',0],['samples','Sample sites','#5ec8d8',nOn,0],['features','Place names','#ffffff','',0],['grid','Lat / lon grid','#999999','',0]]]];
GROUPS.forEach(function(g){var h=document.createElement('h4');h.textContent=g[0];menu.appendChild(h);
 g[1].forEach(function(l){var lb=document.createElement('label');lb.className='chk';
  lb.innerHTML='<input type="checkbox" id="ly-'+l[0]+'"><span class="box"></span><span class="dot" style="border-color:'+l[2]+'"></span><span>'+l[1]+'</span><span class="n">'+l[3]+'</span>';
  var inp=lb.querySelector('input');inp.checked=!!l[4];L[l[0]].style.display=l[4]?'':'none';
  inp.onchange=function(){L[l[0]].style.display=inp.checked?'':'none'};menu.appendChild(lb)})});
mb.onclick=function(){var open=mb.getAttribute('aria-expanded')!=='true';mb.setAttribute('aria-expanded',open);menu.hidden=!open};
var list=document.getElementById('samples');
S.forEach(function(s,i){var r=document.createElement('button');r.className='row';r.innerHTML='<b>'+s[0]+'</b><span>'+s[1]+' <em>· '+s[3].replace(/ \/.*|Crater Rim /,'')+(s.off?' · off this map':'')+'</em></span><em>sol '+s[5]+'</em>';r.onclick=function(){pickSample(i)};list.appendChild(r)});
var info=document.getElementById('info');var ncr=document.getElementById('ncr');if(ncr)ncr.textContent=CR.craters.length;
function setInfo(h,p,m){info.innerHTML='<h2>Selected</h2><h3></h3><p></p><div class="meta"></div>';info.querySelector('h3').textContent=h;info.querySelector('p').textContent=p;info.querySelector('.meta').textContent=m}
function fmt(x,y){var q=ll(x,y);return q[1].toFixed(4)+'°N  '+q[0].toFixed(4)+'°E'}
function pickSample(i){var s=S[i];var rows=list.children;for(var j=0;j<rows.length;j++)rows[j].classList.toggle('on',j===i);rows[i].scrollIntoView({block:'nearest'});
 if(s.off){setInfo('Sample '+s[0]+' · '+s[1],s[2]+' ('+s[3]+'). '+s[4]+' rock, sealed '+s[6]+' on sol '+s[5]+'.','outside the current map area');return}
 setInfo('Sample '+s[0]+' · '+s[1],s[2]+' ('+s[3]+'). '+s[4]+' rock, sealed '+s[6]+' on sol '+s[5]+'.','≈ '+fmt(s.x,s.y)+' · placed by area');focus(s.x,s.y,2.6)}
function pickFeature(f){setInfo(f.n,f.d,fmt(f.x,f.y)+(f.id==='landing'?'':' · approximate'));focus(f.x,f.y,2.2)}

// pan / zoom
var map=document.getElementById('map'),stage=document.getElementById('stage');
var v={s:1,x:0,y:0},base=1;
function fit(){var r=map.getBoundingClientRect();base=Math.max(r.width/W,r.height/H);stage.style.width=W+'px';stage.style.height=H+'px';v.s=1;var k=base;v.x=(r.width-W*k)/2;v.y=(r.height-H*k)/2;apply()}
function apply(clamp){var r=map.getBoundingClientRect(),k=base*v.s;
 v.x=Math.min(0,Math.max(r.width-W*k,v.x));v.y=Math.min(0,Math.max(r.height-H*k,v.y));
 stage.style.transform='translate('+v.x+'px,'+v.y+'px) scale('+k+')';stage.style.setProperty('--inv',1/k);
 var m=(DLON*59.27*Math.cos(18.4*Math.PI/180)*1000)/W;var tgt=[100,200,500,1000,2000,5000,10000].reduce(function(a,b){return b*1/(m)*k<=140?b:a},100);
 document.getElementById('sb').style.width=(tgt/m*k)+'px';document.getElementById('sl').textContent=(tgt>=1000?tgt/1000+' km':tgt+' m')}
function zoomAt(cx,cy,f){var r=map.getBoundingClientRect(),k0=base*v.s,s2=Math.min(12,Math.max(1,v.s*f));if(s2===v.s)return;var k1=base*s2;
 var px=(cx-v.x)/k0,py=(cy-v.y)/k0;v.s=s2;v.x=cx-px*k1;v.y=cy-py*k1;apply()}
function focus(x,y,s){var r=map.getBoundingClientRect();stage.classList.add('ease');v.s=Math.max(v.s,s);var k=base*v.s;v.x=r.width/2-x*k;v.y=r.height/2-y*k;apply();setTimeout(function(){stage.classList.remove('ease')},520)}
map.addEventListener('wheel',function(e){if(e.target.closest('.menu'))return;e.preventDefault();var r=map.getBoundingClientRect();zoomAt(e.clientX-r.left,e.clientY-r.top,e.deltaY<0?1.25:0.8)},{passive:false});
var ptrs={},last=null,pd=0;
map.addEventListener('pointerdown',function(e){if(e.target.closest('.tools,.menu,.menubtn'))return;map.setPointerCapture(e.pointerId);ptrs[e.pointerId]=[e.clientX,e.clientY];map.classList.add('drag');var a=Object.keys(ptrs);if(a.length===2){var p=ptrs[a[0]],q=ptrs[a[1]];pd=Math.hypot(p[0]-q[0],p[1]-q[1])}});
map.addEventListener('pointermove',function(e){var r=map.getBoundingClientRect(),q=ll((e.clientX-r.left-v.x)/(base*v.s),(e.clientY-r.top-v.y)/(base*v.s));document.getElementById('ll').textContent=q[1].toFixed(4)+'°N  '+q[0].toFixed(4)+'°E';
 if(!ptrs[e.pointerId])return;var a=Object.keys(ptrs),o=ptrs[e.pointerId];
 if(a.length===2){ptrs[e.pointerId]=[e.clientX,e.clientY];var p=ptrs[a[0]],q2=ptrs[a[1]],dd=Math.hypot(p[0]-q2[0],p[1]-q2[1]);if(pd)zoomAt((p[0]+q2[0])/2-r.left,(p[1]+q2[1])/2-r.top,dd/pd);pd=dd}
 else{v.x+=e.clientX-o[0];v.y+=e.clientY-o[1];ptrs[e.pointerId]=[e.clientX,e.clientY];apply()}});
function up(e){delete ptrs[e.pointerId];pd=0;if(!Object.keys(ptrs).length)map.classList.remove('drag')}
map.addEventListener('pointerup',up);map.addEventListener('pointercancel',up);
document.getElementById('zi').onclick=function(){var r=map.getBoundingClientRect();zoomAt(r.width/2,r.height/2,1.5)};
document.getElementById('zo').onclick=function(){var r=map.getBoundingClientRect();zoomAt(r.width/2,r.height/2,1/1.5)};
document.getElementById('zr').onclick=fit;
window.addEventListener('resize',fit);
fit();
})();

(() => {
'use strict';
const canvas=document.getElementById('aquarium');
const ctx=canvas.getContext('2d',{alpha:false});
const W=1600,H=1000,TAU=Math.PI*2;
const layer=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c;};
const backdrop=layer(),ground=layer(),frame=layer(),beams=layer();
const bg=backdrop.getContext('2d'),gc=ground.getContext('2d'),fc=frame.getContext('2d');
let seed=8675309;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const rnd=(a,b)=>a+(b-a)*random();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,f)=>a+(b-a)*f;
const ellipse=(c,x,y,rx,ry,color,rotation=0)=>{c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,rotation,0,TAU);c.fill();};
const path=(c,points,color)=>{c.fillStyle=color;c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill();};
let t=0,last=0,paused=false,lighting=0,flow=0,lightValue=0,wakeAt=performance.now(),toastAt=0,hidden=false;
let eaten=0,totalFed=0,frames=0;
const foods=[],ripples=[];
const currentStrength=()=>[.65,1.3,.22][flow];
const plants=[];

function ribbon(c,x,y,height,width,bend,phase,color){
 const sway=Math.sin(t*.43+phase)*11*currentStrength();
 c.fillStyle=color;c.beginPath();c.moveTo(x-width*.12,y);
 c.bezierCurveTo(x-width*.6,y-height*.33,x+bend-width*.48+sway,y-height*.73,x+bend+sway,y-height);
 c.bezierCurveTo(x+bend+width*.68+sway,y-height*.78,x+width*.5,y-height*.28,x+width*.12,y);
 c.fill();
}
function frond(c,x,y,height,phase,color,time=0){
 const bend=Math.sin(time*.37+phase)*12*currentStrength();
 c.strokeStyle=color;c.lineWidth=1.6;c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x-7+bend,y-height*.6,x+bend,y-height);c.stroke();
 for(let i=1;i<12;i++){
  const k=i/12,py=y-height*k,px=x+bend*k*k,wide=Math.sin(k*Math.PI)*height*.135;
  for(const side of [-1,1]){c.fillStyle=color;c.beginPath();c.moveTo(px,py+5);c.quadraticCurveTo(px+wide*side*.3,py-15,px+wide*side,py-height*.065);c.quadraticCurveTo(px+wide*side*.65,py+4,px,py+5);c.fill();}
 }
}
function rock(c,x,y,w,h,col){
 const grad=c.createLinearGradient(x-w/2,y-h,x+w/2,y);grad.addColorStop(0,col);grad.addColorStop(.45,'#3f5144');grad.addColorStop(1,'#263d36');
 path(c,[[x-w*.55,y],[x-w*.46,y-h*.44],[x-w*.24,y-h*.89],[x+w*.08,y-h],[x+w*.43,y-h*.66],[x+w*.54,y-h*.14],[x+w*.4,y+4]],grad);
 path(c,[[x-w*.46,y-h*.44],[x-w*.24,y-h*.89],[x+w*.08,y-h],[x-w*.06,y-h*.43]],'#a0ac7633');
 c.strokeStyle='#192f2d66';c.lineWidth=2;
 for(let i=0;i<5;i++){const xx=x+rnd(-w*.3,w*.3);c.beginPath();c.moveTo(xx,y-h*rnd(.4,.75));c.lineTo(xx+w*.08,y-h*.12);c.stroke();}
 for(let i=0;i<80;i++){const px=x+rnd(-w*.37,w*.35),py=y-h*rnd(.08,.55);ellipse(c,px,py,rnd(1,3),rnd(.6,1.2),'#8b9d632b');}
}
function branch(c,points,width,color){c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();c.moveTo(...points[0]);c.bezierCurveTo(...points[1],...points[2],...points[3]);c.stroke();}
function buildScene(){
 const water=bg.createLinearGradient(0,0,0,H);water.addColorStop(0,'#16474a');water.addColorStop(.35,'#155358');water.addColorStop(.75,'#124344');water.addColorStop(1,'#1e4035');bg.fillStyle=water;bg.fillRect(0,0,W,H);
 const glow=bg.createRadialGradient(640,65,20,640,65,950);glow.addColorStop(0,'#b5d0a037');glow.addColorStop(.55,'#6dba9b0b');glow.addColorStop(1,'#0b2d3700');bg.fillStyle=glow;bg.fillRect(0,0,W,H);
 // The far bank stays soft and still; nearer leaves move independently.
 bg.save();bg.filter='blur(5px)';
 for(let i=0;i<110;i++){const x=rnd(-70,1680),y=950+rnd(-30,40),h=rnd(180,600)*(x>430&&x<1100?.55:1);frond(bg,x,y,h,rnd(0,TAU),['#1d5950','#246353','#24614b','#26594a'][i%4]);}
 bg.restore();
 const mist=bg.createLinearGradient(0,150,0,900);mist.addColorStop(0,'#2d77762b');mist.addColorStop(.65,'#23676310');mist.addColorStop(1,'#153f3a00');bg.fillStyle=mist;bg.fillRect(0,150,W,800);
 // A sand path curves between the two planted islands.
 const sand=gc.createLinearGradient(0,800,0,H);sand.addColorStop(0,'#797c56');sand.addColorStop(.55,'#a1986d');sand.addColorStop(1,'#645f43');
 gc.fillStyle=sand;gc.beginPath();gc.moveTo(0,854);gc.bezierCurveTo(350,866,438,922,750,904);gc.bezierCurveTo(1170,876,1250,850,1600,856);gc.lineTo(1600,1000);gc.lineTo(0,1000);gc.fill();
 for(let i=0;i<10500;i++){const x=rnd(0,W),y=rnd(873,H),r=rnd(.45,1.8);ellipse(gc,x,y,r,r*.5,['#c3bc8f44','#283d2940','#b1aa794b','#393e2940'][i%4]);}
 rock(gc,380,895,230,137,'#768665');rock(gc,498,912,161,86,'#7d8968');rock(gc,296,891,113,80,'#65775a');
 rock(gc,1125,908,252,142,'#758163');rock(gc,1268,914,173,85,'#7a8163');rock(gc,1015,920,111,62,'#83856a');
 // Smooth, branching driftwood and a thin highlight along the grain.
 branch(gc,[[820,911],[858,855],[1022,784],[1124,641]],65,'#354236');
 branch(gc,[[830,901],[904,846],[1012,776],[1124,641]],40,'#655e3e');
 branch(gc,[[858,893],[915,825],[1044,760],[1124,641]],17,'#8b7950');
 branch(gc,[[995,803],[954,720],[893,700],[887,639]],20,'#57553b');
 branch(gc,[[1044,750],[1104,730],[1158,726],[1197,676]],15,'#626041');
 branch(gc,[[1090,692],[1047,650],[1050,595],[1024,565]],11,'#5b5a3e');
 branch(gc,[[861,880],[773,883],[742,824],[692,816]],27,'#52553a');
 for(let i=0;i<16;i++)branch(gc,[[837+i*1.8,907],[900+i*1.3,844],[1032+i*.5,758],[1115+i*.2,656]],.8,'#b2a06b22');
 for(let i=0;i<320;i++){const q=random(),x=lerp(850,1125,q)+rnd(-20,12),y=lerp(895,650,q)+Math.sin(q*5)*17+rnd(-8,8);ellipse(gc,x,y,rnd(2,6),rnd(1,3),['#5e7947','#7a8b4d','#416b47','#91a05d66'][i%4],rnd(-1,1));}
 // Broad anubias leaves clustered around the base of the stones.
 for(const [x,y] of [[300,891],[452,908],[1100,907],[1250,916]])for(let i=0;i<25;i++){
  const a=rnd(-2.9,-.3),len=rnd(25,85),ex=x+Math.cos(a)*len,ey=y+Math.sin(a)*len;
  gc.strokeStyle='#537747';gc.lineWidth=2;gc.beginPath();gc.moveTo(x,y);gc.lineTo(ex,ey);gc.stroke();
  const gr=gc.createLinearGradient(ex-18,ey-10,ex+18,ey+10);gr.addColorStop(0,'#729351');gr.addColorStop(.48,'#517e45');gr.addColorStop(1,'#234d37');ellipse(gc,ex,ey,rnd(16,27),rnd(8,13),gr,a);
  gc.strokeStyle='#a4ba662e';gc.lineWidth=.8;gc.beginPath();gc.moveTo(ex-Math.cos(a)*19,ey-Math.sin(a)*19);gc.lineTo(ex+Math.cos(a)*19,ey+Math.sin(a)*19);gc.stroke();
 }
 // Fine foreground carpet, pebbles and two small snails.
 for(let i=0;i<500;i++){const x=rnd(-30,1630),y=rnd(935,1015);if(x>500&&x<1040&&random()<.94)continue;gc.strokeStyle=['#527746','#63834d','#355d3a','#819355'][i%4];gc.lineWidth=rnd(1,2);gc.beginPath();gc.moveTo(x,y);gc.quadraticCurveTo(x+rnd(-7,7),y-12,x+rnd(-10,10),y-rnd(10,27));gc.stroke();}
 for(let i=0;i<85;i++){const x=rnd(0,W),y=rnd(918,1000);ellipse(gc,x,y,rnd(2,6),rnd(1,2.5),['#b1ab87','#7d8061','#4f634d'][i%3]);}
 for(const [x,y] of [[595,941],[1325,947]]){ellipse(gc,x,y+4,11,3,'#56654d');ellipse(gc,x-2,y-2,8,7,'#978361');gc.strokeStyle='#5c634d';gc.lineWidth=1;gc.beginPath();gc.arc(x-2,y-2,5,0,TAU*1.5);gc.stroke();}
 // Small air stone tucked into the right-hand planting.
 ellipse(gc,1385,906,27,9,'#536956');ellipse(gc,1385,902,24,6,'#71856a');
 // Glass edge shading is cached, leaving the water itself transparent.
 const vignette=fc.createRadialGradient(800,440,300,800,440,1020);vignette.addColorStop(0,'#021d2300');vignette.addColorStop(.7,'#051f2920');vignette.addColorStop(1,'#031a2799');fc.fillStyle=vignette;fc.fillRect(0,0,W,H);
 const top=fc.createLinearGradient(0,0,0,150);top.addColorStop(0,'#0a2c3444');top.addColorStop(1,'#0a2c3400');fc.fillStyle=top;fc.fillRect(0,0,W,150);
 for(let i=0;i<37;i++)plants.push({type:'ribbon',x:rnd(-40,290),y:rnd(940,1010),h:rnd(270,690),w:rnd(8,24),bend:rnd(-60,100),phase:rnd(0,TAU),color:['#527e45','#3b6e43','#659451','#2f603d','#7c9d5b'][i%5]});
 for(let i=0;i<24;i++)plants.push({type:'frond',x:rnd(1270,1650),y:rnd(930,1015),h:rnd(230,560),phase:rnd(0,TAU),color:['#426f43','#547d44','#6a8e4f','#315c3d'][i%4]});
 for(let i=0;i<14;i++)plants.push({type:'ribbon',x:rnd(55,390),y:rnd(978,1040),h:rnd(70,180),w:rnd(5,10),bend:rnd(-20,30),phase:rnd(0,TAU),color:['#89a85a','#709749','#537e42'][i%3]});
}
buildScene();
const fish=[];
function addFish(type,count){for(let i=0;i<count;i++){
 const size=type==='angel'?rnd(61,86):type==='amber'?rnd(27,38):rnd(23,33),vx=(random()>.5?1:-1)*rnd(14,25);
 fish.push({type,size,x:rnd(240,1370),y:type==='angel'?rnd(300,675):type==='amber'?rnd(400,725):rnd(230,640),vx,vy:rnd(-3,3),phase:rnd(0,TAU),turn:vx<0?-1:1,depth:rnd(.7,1),target:null});
}}
addFish('neon',18);addFish('amber',8);addFish('angel',4);
const motes=Array.from({length:75},()=>({x:rnd(0,W),y:rnd(80,930),r:rnd(.4,1.5),a:rnd(.08,.32),p:rnd(0,TAU)}));
const bubbles=Array.from({length:24},()=>({p:rnd(0,1),r:rnd(1.4,4.8),off:rnd(-19,19),speed:rnd(14,26)}));
const rays=Array.from({length:7},(_,i)=>({x:175+i*150,w:rnd(18,45),angle:rnd(.08,.35),p:rnd(0,TAU)}));
const rayGradient=ctx.createLinearGradient(0,40,0,890);rayGradient.addColorStop(0,'#c4e4bb20');rayGradient.addColorStop(.32,'#c4e4bb0c');rayGradient.addColorStop(1,'#c4e4bb00');
const beamContext=beams.getContext('2d');
beamContext.filter='blur(17px)';beamContext.fillStyle=rayGradient;
for(const ray of rays){beamContext.beginPath();beamContext.moveTo(ray.x,-20);beamContext.lineTo(ray.x+ray.w,-20);beamContext.lineTo(ray.x+ray.w+250,930);beamContext.lineTo(ray.x+145,930);beamContext.closePath();beamContext.fill();}

function fishBody(f){
 const s=f.size,tail=Math.sin(t*3.8+f.phase)*(f.type==='angel'?.08:.2),squeeze=Math.max(.15,Math.abs(f.turn)),sign=f.turn<0?-1:1;
 ctx.save();ctx.translate(f.x,f.y);ctx.rotate(clamp(f.vy/Math.max(Math.abs(f.vx),10),-.28,.28)*sign);ctx.scale(sign*squeeze,1);
 ctx.globalAlpha=f.depth;
 if(f.type==='angel'){
  // Veiled fins, a silver body and three softly edged vertical bands.
  const fin=ctx.createLinearGradient(0,-s,0,s);fin.addColorStop(0,'#bad5b442');fin.addColorStop(.5,'#bfcead95');fin.addColorStop(1,'#c6dbb71f');
  ctx.fillStyle=fin;ctx.beginPath();ctx.moveTo(-s*.29,-s*.12);ctx.bezierCurveTo(-s*.14,-s*.5,s*.15,-s*.98,s*.18,-s*.75);ctx.quadraticCurveTo(s*.29,-s*.28,s*.39,-s*.06);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(-s*.2,s*.15);ctx.quadraticCurveTo(-s*.03,s*.78,s*.16,s*.91+Math.sin(t+f.phase)*4);ctx.quadraticCurveTo(s*.19,s*.42,s*.39,s*.12);ctx.closePath();ctx.fill();
  path(ctx,[[-s*.28,0],[-s*.75,-s*.28+tail*s],[-s*.66,s*.28+tail*s]],'#b1c9b16b');
  const body=ctx.createLinearGradient(-s*.4,-s*.2,s*.4,s*.2);body.addColorStop(0,'#7fa89c');body.addColorStop(.35,'#d4ddbd');body.addColorStop(.7,'#b9cbb1');body.addColorStop(1,'#afbc8e');
  ellipse(ctx,0,0,s*.38,s*.43,body);
  ctx.save();ctx.beginPath();ctx.ellipse(0,0,s*.38,s*.43,0,0,TAU);ctx.clip();
  for(const a of [-.24,-.02,.2]){ctx.fillStyle='#34544d9c';ctx.beginPath();ctx.moveTo(s*a-s*.04,-s*.47);ctx.lineTo(s*a+s*.035,-s*.47);ctx.lineTo(s*a+s*.11,s*.48);ctx.lineTo(s*a+s*.015,s*.48);ctx.fill();}
  ctx.restore();
  ctx.strokeStyle='#dce6c777';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(s*.06,s*.23);ctx.quadraticCurveTo(s*.2,s*.67,s*.03+Math.sin(t*.8+f.phase)*6,s*.99);ctx.stroke();
  ctx.strokeStyle='#dae5c87a';ctx.beginPath();ctx.moveTo(s*.15,s*.21);ctx.quadraticCurveTo(s*.3,s*.72,s*.2+Math.sin(t*.9+f.phase)*5,s*.93);ctx.stroke();
  ellipse(ctx,s*.25,-s*.04,s*.065,s*.07,'#c7b879');ellipse(ctx,s*.27,-s*.04,s*.035,s*.041,'#173b3c');ellipse(ctx,s*.28,-s*.055,s*.011,s*.014,'#d2e7d1');
  ctx.strokeStyle='#49695c66';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(s*.2,s*.04,s*.1,s*.18,0,Math.PI*.5,Math.PI*1.5);ctx.stroke();
  path(ctx,[[s*.04,s*.1],[s*.18,s*.36+Math.sin(t*4+f.phase)*s*.04],[-s*.08,s*.23]],'#d4e0b943');
 }else{
  const neon=f.type==='neon';
  const tailCol=neon?'#92a7a866':'#d4a4698c';
  path(ctx,[[-s*.44,0],[-s*.91,-s*.23+tail*s],[-s*.83,tail*s*.3],[-s*.91,s*.23+tail*s]],tailCol);
  const body=ctx.createLinearGradient(0,-s*.2,0,s*.23);body.addColorStop(0,neon?'#416b6a':'#d1a76b');body.addColorStop(.45,neon?'#92c1b5':'#ebc38a');body.addColorStop(1,neon?'#839c93':'#9a7652');
  ellipse(ctx,0,0,s*.58,s*(neon?.19:.25),body);
  path(ctx,[[-s*.1,-s*.1],[s*.05,-s*.42],[-s*.33,-s*.12]],neon?'#aacac44a':'#e6c59466');
  path(ctx,[[-s*.03,s*.12],[-s*.18,s*.37],[-s*.32,s*.1]],'#c4d6b94a');
  if(neon){
   ctx.strokeStyle='#60d8dc';ctx.lineWidth=s*.065;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-s*.42,-s*.025);ctx.quadraticCurveTo(-s*.02,-s*.11,s*.39,-s*.07);ctx.stroke();
   ctx.strokeStyle='#d75f4c';ctx.lineWidth=s*.09;ctx.beginPath();ctx.moveTo(-s*.42,s*.09);ctx.lineTo(s*.09,s*.06);ctx.stroke();
   ctx.strokeStyle='#b1f1d877';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(-s*.23,-s*.1);ctx.lineTo(s*.33,-s*.12);ctx.stroke();
  }else{path(ctx,[[-s*.3,-s*.17],[s*.01,s*.03],[-s*.4,s*.19]],'#394941');ctx.strokeStyle='#f9df9c88';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(-s*.24,-s*.18);ctx.quadraticCurveTo(s*.2,-s*.24,s*.44,-s*.09);ctx.stroke();}
  ellipse(ctx,s*.37,-s*.035,s*.065,s*.065,neon?'#c1e6c8':'#f1d49c');ellipse(ctx,s*.39,-s*.03,s*.032,s*.04,'#19353a');
  path(ctx,[[s*.08,s*.03],[s*.22,s*.22+Math.sin(t*6+f.phase)*s*.04],[-s*.05,s*.13]],'#dce8ca55');
 }
 ctx.restore();ctx.globalAlpha=1;
}

function update(dt){
 t+=dt;const strength=currentStrength();
 lightValue=lerp(lightValue,lighting,Math.min(1,dt*.75));
 for(let i=foods.length-1;i>=0;i--){const food=foods[i];food.y+=food.speed*dt;food.x+=Math.sin(t*.8+food.phase)*dt*2*strength;food.age+=dt;if(food.y>906||food.age>36)foods.splice(i,1);}
 for(const f of fish){
  let ax=0,ay=0,target=null,best=Infinity;
  for(const food of foods){const d=Math.hypot(food.x-f.x,food.y-f.y);if(d<best&&d<440){best=d;target=food;}}
  const cruise=f.type==='angel'?15:f.type==='amber'?22:26;
  if(target){const dx=target.x-f.x,dy=target.y-f.y,d=Math.max(1,Math.hypot(dx,dy));const speed=cruise*2.7;ax+=(dx/d*speed-f.vx)*.7;ay+=(dy/d*speed-f.vy)*.7;
   if(d<f.size*.48+7){const i=foods.indexOf(target);if(i>=0){foods.splice(i,1);eaten++;}}
  }else{
   const direction=f.vx<0?-1:1;
   ax+=(direction*cruise*(.75+strength*.18)-f.vx)*.16;
   ay+=(Math.sin(t*.19+f.phase)*5-f.vy)*.3;
   const home=f.type==='angel'?510:f.type==='amber'?520:420;
   ay+=(home+Math.sin(t*.06+f.phase)*135-f.y)*.008;
   let cx=0,cy=0,n=0;
   for(const other of fish){if(other===f||other.type!==f.type)continue;const dx=other.x-f.x,dy=other.y-f.y,d=Math.hypot(dx,dy);
    if(d<42){ax-=dx*.025;ay-=dy*.045;}
    else if(d<220){cx+=other.vx;cy+=other.y;n++;}
   }
   if(n){ax+=(cx/n-f.vx)*.07;ay+=(cy/n-f.y)*.009;}
  }
  if(f.x<110)ax+=(110-f.x)*.19;if(f.x>1490)ax-=(f.x-1490)*.19;
  if(f.y<150)ay+=(150-f.y)*.09;if(f.y>815)ay-=(f.y-815)*.1;
  f.vx=clamp(f.vx+ax*dt,-85,85);f.vy=clamp(f.vy+ay*dt,-65,65);
  f.x=clamp(f.x+f.vx*dt,65,1535);f.y=clamp(f.y+f.vy*dt,115,850);
  f.turn=lerp(f.turn,f.vx<0?-1:1,Math.min(1,dt*2));
 }
 for(let i=ripples.length-1;i>=0;i--){ripples[i].age+=dt;if(ripples[i].age>3)ripples.splice(i,1);}
}

function render(){
 ctx.drawImage(backdrop,0,0);
 // Light shafts drift slowly through the water column.
 ctx.save();ctx.globalAlpha=1-clamp(lightValue*.48,0,.85);
 ctx.drawImage(beams,Math.sin(t*.11)*18*currentStrength(),0);
 ctx.restore();
 // Fish are layered among the hardscape and the closer plants.
 fish.filter(f=>f.depth<.84).sort((a,b)=>a.size-b.size).forEach(fishBody);
 ctx.drawImage(ground,0,0);
 // Ground caustics, thin and uneven, follow the current.
 ctx.save();ctx.globalAlpha=.1*(1-lightValue*.3);ctx.strokeStyle='#d2dfac';ctx.lineWidth=1;
 for(let k=0;k<12;k++){ctx.beginPath();for(let j=0;j<=22;j++){const x=300+j*46,y=915+k*8+Math.sin(j*.8+k+t*.23)*7+Math.sin(j*1.8+t*.15)*3;j?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();}ctx.restore();
 fish.filter(f=>f.depth>=.84).sort((a,b)=>a.size-b.size).forEach(fishBody);
 for(const plant of plants){if(plant.type==='ribbon')ribbon(ctx,plant.x,plant.y,plant.h,plant.w,plant.bend,plant.phase,plant.color);else frond(ctx,plant.x,plant.y,plant.h,plant.phase,plant.color,t);}
 // A few near-glass blades frame the sand without filling the open water.
 for(let i=0;i<11;i++)ribbon(ctx,1400+i*19,1040,125+(i%4)*27,10,Math.sin(i)*18,i,'#557c46');
 if(lightValue>.01){ctx.fillStyle=`rgba(${lightValue<1?'87,61,27':'13,22,67'},${lightValue<1?lightValue*.18:.18+(lightValue-1)*.24})`;ctx.fillRect(0,0,W,H);}
 for(const mote of motes){const x=(mote.x+Math.sin(t*.08+mote.p)*15+t*.4*currentStrength())%W,y=(mote.y+Math.sin(t*.13+mote.p)*9);ellipse(ctx,x,y,mote.r,mote.r,'rgba(215,232,199,'+mote.a+')');}
 for(const bubble of bubbles){const progress=(bubble.p+t*bubble.speed/850)%1,y=903-progress*850,x=1385+bubble.off+Math.sin(progress*12+t*.4)*7;
  ctx.strokeStyle='#c4e4d23a';ctx.lineWidth=.8;ctx.beginPath();ctx.ellipse(x,y,bubble.r,bubble.r*1.07,0,0,TAU);ctx.stroke();ellipse(ctx,x-bubble.r*.27,y-bubble.r*.35,.7,.7,'#d5ecdc55');
 }
 for(const food of foods){ellipse(ctx,food.x,food.y,2.5,1.5,'#d2ad72',Math.sin(t+food.phase)*.4);ellipse(ctx,food.x-.5,food.y-.7,.7,.4,'#edd9a3');}
 for(const ripple of ripples){ctx.strokeStyle=`rgba(191,226,202,${(1-ripple.age/3)*.28})`;ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(ripple.x,ripple.y,6+ripple.age*34,2+ripple.age*10,0,0,TAU);ctx.stroke();}
 // Surface reflections and a dark glass edge keep the composition quiet.
 ctx.strokeStyle='#c4dfbd12';ctx.lineWidth=1;for(let k=0;k<3;k++){ctx.beginPath();for(let j=0;j<30;j++){const x=j*58,y=73+k*9+Math.sin(j*.45+t*.23+k)*3;j?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();}
 ctx.drawImage(frame,0,0);frames++;
}
function tick(now){
 if(!last)last=now;
 const elapsed=now-last;
 if(elapsed>=1000/30){last=now;if(!paused&&!hostPaused)update(Math.min(elapsed/1000,.075));if(!paused&&!hostPaused)render();}
 if(wallpaperAdapter.context().capabilities.pointerMove&&now-wakeAt>8000&&document.getElementById('help-panel').hidden&&!document.querySelector('.controls').contains(document.activeElement))document.body.classList.add('idle');
 if(toastAt&&now-toastAt>3000){document.getElementById('toast').classList.remove('show');toastAt=0;}
 requestAnimationFrame(tick);
}
function wake(){wakeAt=performance.now();document.body.classList.remove('idle');}
function toast(message){const node=document.getElementById('toast');node.textContent=message;node.classList.add('show');toastAt=performance.now();}
function feed(x=800,y=210){
 if(paused){toast('先让时间继续流动吧。');return {ok:false,code:'PAUSED',message:'水族箱已暂停，请先继续画面。'};}
 if(foods.length>42){toast('先让鱼儿慢慢吃完这一餐。');return {ok:false,code:'DISABLED',message:'先让鱼儿慢慢吃完这一餐。'};}
 for(let i=0;i<7;i++)foods.push({x:clamp(x+rnd(-18,18),90,1510),y:clamp(y+rnd(-9,9),115,760),speed:rnd(8,13),phase:rnd(0,TAU),age:0});
 ripples.push({x,y,age:0});totalFed+=7;toast('一点小小的好心情，鱼儿收到了。');return {ok:true,data:{foods:foods.length,totalFed}};
}
function switchLight(){lighting=(lighting+1)%3;document.getElementById('light-label').textContent=['晨光','暮色','月光'][lighting];toast(['把清晨的光，留在水里。','水草也有自己的黄昏。','今夜，和鱼儿一起看月光。'][lighting]);}
function switchFlow(){flow=(flow+1)%3;document.getElementById('flow-label').textContent=['缓流','轻涌','静水'][flow];toast(['水草在缓缓呼吸。','一阵小小的水流经过。','安静一点，再安静一点。'][flow]);}
function pause(){paused=!paused;document.getElementById('pause').setAttribute('aria-pressed',String(paused));document.getElementById('pause-icon').textContent=paused?'▷':'Ⅱ';document.getElementById('pause-label').textContent=paused?'继续':'暂停';document.getElementById('pause-badge').hidden=!paused;}
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('按 F11，也能进入或退出全屏。');}}
function help(){const panel=document.getElementById('help-panel');panel.hidden=!panel.hidden;document.getElementById('help').setAttribute('aria-expanded',String(!panel.hidden));wake();}
function clock(){const now=new Date();document.getElementById('time').textContent=now.toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});document.getElementById('date').textContent=now.toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'short'});}
document.getElementById('feed').onclick=()=>feed();document.getElementById('light').onclick=switchLight;document.getElementById('flow').onclick=switchFlow;document.getElementById('pause').onclick=pause;document.getElementById('fullscreen').onclick=fullscreen;document.getElementById('help').onclick=help;document.getElementById('close-help').onclick=help;
canvas.addEventListener('click',event=>{const scale=Math.max(innerWidth/W,innerHeight/H),x=(event.clientX-(innerWidth-W*scale)/2)/scale,y=(event.clientY-(innerHeight-H*scale)/2)/scale;feed(x,y);});
document.addEventListener('pointermove',wake,{passive:true});document.addEventListener('pointerdown',wake,{passive:true});
document.addEventListener('keydown',event=>{if(!wallpaperAdapter.context().capabilities.keyboard||event.ctrlKey||event.altKey||event.metaKey||event.repeat)return;wake();switch(event.key.toLowerCase()){case 'e':feed();break;case 'l':switchLight();break;case 'c':switchFlow();break;case ' ':event.preventDefault();pause();break;case 'f':fullscreen();break;case 'h':help();break;case 's':hidden=!hidden;document.body.classList.toggle('hidden-ui',hidden);break;}});
document.addEventListener('visibilitychange',()=>{last=0;});

let clockTimer=null,hostPaused=wallpaperAdapter.state().paused;
function syncActivity(){
 hostPaused=wallpaperAdapter.state().paused;last=0;wake();
 if(hostPaused||document.hidden){if(clockTimer!==null)clearInterval(clockTimer);clockTimer=null;}
 else if(clockTimer===null){clock();clockTimer=setInterval(clock,1000);}
}
window.addEventListener('wallpaperhost:statechange',syncActivity);
window.addEventListener('pageshow',syncActivity);
window.addEventListener('pagehide',()=>{if(clockTimer!==null)clearInterval(clockTimer);clockTimer=null;});
document.addEventListener('visibilitychange',syncActivity);

function configureEnvironment(){
 const {mode,capabilities}=wallpaperAdapter.context();
 document.documentElement.dataset.wallpaperMode=mode;
 if(!capabilities.fullscreen)document.getElementById('fullscreen').hidden=true;
 if(!capabilities.keyboard){
  for(const button of document.querySelectorAll('.controls button[title]'))button.title=button.title.replace(/（.*?）/g,'').split('；')[0];
  document.getElementById('help-panel').querySelector('dl').hidden=true;
  document.getElementById('help-panel').querySelector('.muted').textContent=capabilities.pointerMove?'移动鼠标到桌面空白处可唤回控制栏。使用控制栏暂停画面；主程序或托盘可暂停整张壁纸。':'使用下方控制栏操作画面；当前保持控制栏可见。';
  document.querySelector('#pause-badge small').textContent='点击控制栏的“继续”恢复画面';
 }
 wake();syncActivity();
}
window.wallpaperApp=wallpaperAdapter.createActions([
 {id:'feed',label:'投喂鱼儿',allowWhenOccluded:true,
  disabledReason:()=>paused?'水族箱已暂停，请先继续画面。':foods.length>42?'先让鱼儿慢慢吃完这一餐。':undefined,run:()=>feed()},
 {id:'light',label:'切换光照',disabledReason:()=>paused?'水族箱已暂停，请先继续画面。':undefined,
  run:()=>{switchLight();return {ok:true,data:{lighting}};}},
 {id:'flow',label:'切换水流',disabledReason:()=>paused?'水族箱已暂停，请先继续画面。':undefined,
  run:()=>{switchFlow();return {ok:true,data:{flow}};}}
]);
function applySettings(settings){
 lighting=Number.isInteger(settings.lighting)&&settings.lighting>=0&&settings.lighting<3?settings.lighting:0;
 flow=Number.isInteger(settings.flow)&&settings.flow>=0&&settings.flow<3?settings.flow:0;
 lightValue=lighting;
 document.getElementById('light-label').textContent=['晨光','暮色','月光'][lighting];
 document.getElementById('flow-label').textContent=['缓流','轻涌','静水'][flow];
}
window.addEventListener('wallpaperhost:settingschange',event=>applySettings(event.detail.settings));
applySettings(wallpaperAdapter.context().host?.getSettings?.()||{});
wallpaperAdapter.ready(configureEnvironment);

render();requestAnimationFrame(tick);
// Read-only diagnostics for local browser verification, independent of gallery discovery.
window.aquarium={getState:()=>({time:t,paused,lighting,flow,fish:fish.length,foods:foods.length,eaten,totalFed,frames,positions:fish.map(f=>({x:f.x,y:f.y}))})};
})();

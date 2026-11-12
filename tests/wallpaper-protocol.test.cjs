/* Real, scene-independent browser protocol regressions. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'../wallpaper-host/node_modules/playwright-core');
const wrapper=fs.readFileSync(path.resolve(__dirname,'../wallpaper-host/src-tauri/wallpaper-mode.js'),'utf8');
const scene=`
<style>.hud,.overlay,.toast,.help-panel,.pause-badge{padding:8px;background:#eef3e9}</style>
<div class="hud">普通 HUD</div><div class="overlay">普通叠层</div>
<div class="toast">普通提示</div><div class="help-panel">普通帮助</div><div class="pause-badge">普通状态</div>
<button id="scene-button">增加一次</button><script>
window.sceneCount=0;window.frameCount=0;
document.getElementById('scene-button').onclick=()=>window.sceneCount++;
function frame(){window.frameCount++;requestAnimationFrame(frame)}requestAnimationFrame(frame);
window.wallpaperApp={protocolVersion:1,
 getActions:()=>[{id:'burst',label:'点亮',enabled:true}],
 invoke:request=>{window.sceneCount++;return {ok:true,requestId:request.requestId,data:{total:window.sceneCount}}}
};
</script>`;
function initialization(mode='desktop',pause={paused:false,pauseReason:'none'}){
 return 'window.originalRAF=window.requestAnimationFrame;('+wrapper+')('+JSON.stringify({mode})+');'+
  'window.initialHostState=wallpaperHost.getState();window.earlyAction=__SCREEN_GARDEN_INVOKE_ACTION('+
  JSON.stringify({protocolVersion:1,instanceId:'replaced-below',requestId:'early',actionId:'burst'}).replace('"replaced-below"','wallpaperHost.instanceId')+
  ').result;document.addEventListener("DOMContentLoaded",()=>__SCREEN_GARDEN_SET_PAUSED('+JSON.stringify(pause)+'),{once:true});';
}
(async()=>{
 const server=http.createServer((request,response)=>{
  if(request.url==='/favicon.ico'){response.writeHead(204).end();return;}
  const mode=new URL(request.url,'http://localhost').searchParams.get('mode')||'desktop';
  response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
  response.end('<!doctype html><html><head>'+(mode==='browser'?'':'<script>'+initialization(mode)+'</script>')+'</head><body>'+scene+'</body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.EDGE_PATH?{executablePath:process.env.EDGE_PATH}:{channel:'msedge'})});
 let passed=0;
 async function test(name,body,mode='desktop'){
  const context=await browser.newContext({viewport:{width:1000,height:700}}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{
   if(new URL(route.request().url()).origin!==address){external.push(route.request().url());return route.abort();}
   return route.continue();
  });
  await page.clock.install();await page.goto(address+'/?mode='+mode);
  await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+100));
  try{await body(page);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);passed++;console.log('PASS '+name);}
  finally{await context.close();}
 }
 async function invoke(page,requestId,actionId='burst',extra={}){
  return page.evaluate(({requestId,actionId,extra})=>__SCREEN_GARDEN_INVOKE_ACTION({
   protocolVersion:1,instanceId:wallpaperHost.instanceId,requestId,actionId,...extra
  }).result,{requestId,actionId,extra});
 }
 try{
  await test('desktop context is immutable, initially suspended and reports loading',async page=>{
   const info=await page.evaluate(()=>({
    initial:initialHostState,loading:earlyAction,mode:wallpaperHost.mode,caps:wallpaperHost.capabilities,
    frozen:Object.isFrozen(wallpaperHost)&&Object.isFrozen(wallpaperHost.capabilities)&&Object.isFrozen(wallpaperHost.getState()),
    descriptor:Object.getOwnPropertyDescriptor(window,'wallpaperHost'),id:wallpaperHost.instanceId
   }));
   assert.deepEqual(info.initial,{paused:true,pauseReason:'system'});assert.equal(info.loading.code,'NOT_READY');
   assert.equal(info.mode,'desktop');assert.equal(info.caps.keyboard,false);assert.equal(info.caps.fullscreen,false);
   assert.equal(info.frozen,true);assert.equal(info.descriptor.writable,false);assert.equal(info.descriptor.configurable,false);
   assert.ok(info.id.length>0&&info.id.length<=128);
  });
  await test('generic class names, styles and buttons are untouched',async page=>{
   for(const selector of ['.hud','.overlay','.toast','.help-panel','.pause-badge'])assert.equal(await page.locator(selector).isVisible(),true);
   assert.equal(await page.locator('style').count(),1);
   const reply=await page.evaluate(()=>{
    const r=document.getElementById('scene-button').getBoundingClientRect();
    return __SCREEN_GARDEN_DESKTOP_CLICK((r.x+r.width/2)/innerWidth,(r.y+r.height/2)/innerHeight);
   });
   assert.equal(reply.delivered,true);assert.equal(await page.evaluate(()=>sceneCount),1);
   assert.deepEqual(Object.keys(reply).sort(),['delivered','x','y']);
  });
  await test('pause-reason changes are observable while frozen and RAF callbacks survive resume',async page=>{
   await page.clock.runFor(100);const before=await page.evaluate(()=>frameCount);
   await page.evaluate(()=>{
    window.events=[];window.oldSnapshot=wallpaperHost.getState();
    addEventListener('wallpaperhost:statechange',event=>events.push({...event.detail}));
    __SCREEN_GARDEN_SET_PAUSED({paused:true,pauseReason:'occluded'});
    __SCREEN_GARDEN_SET_PAUSED({paused:true,pauseReason:'manual'});
    __SCREEN_GARDEN_SET_PAUSED({paused:true,pauseReason:'none'});
   });
   await page.clock.runFor(1000);assert.equal(await page.evaluate(()=>frameCount),before);
   assert.deepEqual(await page.evaluate(()=>events),[{paused:true,pauseReason:'occluded'},{paused:true,pauseReason:'manual'}]);
   assert.deepEqual(await page.evaluate(()=>oldSnapshot),{paused:false,pauseReason:'none'});
   await page.evaluate(()=>__SCREEN_GARDEN_SET_PAUSED({paused:false,pauseReason:'none'}));
   await page.clock.runFor(100);assert.ok(await page.evaluate(()=>frameCount)>before);
  });
  await test('operations execute once and stale documents cannot authorize a new scene',async page=>{
   assert.equal((await invoke(page,'r1')).data.total,1);
   assert.equal((await invoke(page,'r1')).data.total,1);
   assert.equal((await invoke(page,'r1','different')).code,'INVALID_REQUEST');
   assert.equal((await invoke(page,'r2','unknown')).code,'UNKNOWN_ACTION');
   const oldId=await page.evaluate(()=>wallpaperHost.instanceId);
   await page.reload();assert.notEqual(await page.evaluate(()=>wallpaperHost.instanceId),oldId);
   assert.equal((await invoke(page,'r3','burst',{instanceId:oldId})).code,'STALE_INSTANCE');
   assert.equal(await page.evaluate(()=>sceneCount),0);
  });
  await test('execution rechecks descriptors, occlusion opt-in and manual pause',async page=>{
   await page.evaluate(()=>wallpaperApp.getActions=()=>[{id:'burst',label:'点亮',enabled:false,disabledReason:'正在冷却'}]);
   assert.equal((await invoke(page,'disabled')).code,'DISABLED');
   await page.evaluate(()=>{
    wallpaperApp.getActions=()=>[{id:'burst',label:'点亮',enabled:true,allowWhenOccluded:true}];
    __SCREEN_GARDEN_SET_PAUSED({paused:true,pauseReason:'occluded'});
   });
   assert.equal((await invoke(page,'occluded')).ok,true);
   await page.evaluate(()=>__SCREEN_GARDEN_SET_PAUSED({paused:true,pauseReason:'manual'}));
   assert.equal((await invoke(page,'manual')).code,'PAUSED');assert.equal(await page.evaluate(()=>sceneCount),1);
  });
  await test('invalid descriptors and oversized data cannot become manager actions',async page=>{
   const cases=[
    [{id:'burst',label:'🌟'.repeat(17),enabled:true}],
    [{id:'burst',label:'点亮',enabled:true},{id:'burst',label:'第二个',enabled:true}],
    [{id:'burst',label:'点亮',enabled:true,unused:'x'.repeat(9000)}],
    [{id:'bad:id',label:'点亮',enabled:true}]
   ];
   for(const value of cases){
    const reply=await page.evaluate(value=>{wallpaperApp.getActions=()=>value;return __SCREEN_GARDEN_GET_ACTIONS();},value);
    assert.deepEqual(reply.actions,[]);assert.ok(reply.error);
   }
   const accepted=await page.evaluate(()=>{wallpaperApp.getActions=()=>[{id:'burst',label:'🌟'.repeat(16),enabled:true}];return __SCREEN_GARDEN_GET_ACTIONS();});
   assert.equal(accepted.actions.length,1);
  });
  await test('bad acknowledgement never claims success or automatically repeats a side effect',async page=>{
   await page.evaluate(()=>wallpaperApp.invoke=()=>{sceneCount++;throw new Error('after mutation');});
   assert.equal((await invoke(page,'throwing')).code,'RESULT_UNKNOWN');assert.equal((await invoke(page,'throwing')).code,'RESULT_UNKNOWN');
   assert.equal(await page.evaluate(()=>sceneCount),1);
   await page.evaluate(()=>wallpaperApp.invoke=()=>({ok:true,requestId:'wrong'}));
   assert.equal((await invoke(page,'wrong-id')).code,'RESULT_UNKNOWN');
   await page.evaluate(()=>wallpaperApp.invoke=request=>({ok:true,requestId:request.requestId,data:'x'.repeat(9000)}));
   assert.equal((await invoke(page,'too-large')).code,'RESULT_UNKNOWN');
   await page.evaluate(()=>wallpaperApp.invoke=async()=>{sceneCount++;return {};});
   assert.equal((await invoke(page,'async')).code,'UNSUPPORTED');assert.equal(await page.evaluate(()=>sceneCount),1);
  });
  await test('preview has context without desktop scheduling or action privileges',async page=>{
   const result=await page.evaluate(()=>{
    __SCREEN_GARDEN_SET_PAUSED(true);
    return {mode:wallpaperHost.mode,caps:wallpaperHost.capabilities,state:wallpaperHost.getState(),
     same:originalRAF===requestAnimationFrame,actions:__SCREEN_GARDEN_GET_ACTIONS().actions,
     input:__SCREEN_GARDEN_DESKTOP_CLICK(.5,.5)};
   });
   assert.equal(result.mode,'preview');assert.equal(result.caps.actions,false);assert.equal(result.caps.pause,false);
   assert.equal(result.caps.keyboard,true);assert.equal(result.same,true);assert.equal(result.state.paused,false);
   assert.deepEqual(result.actions,[]);assert.equal(result.input.delivered,false);
   await page.locator('#scene-button').click({force:true});assert.equal(await page.evaluate(()=>sceneCount),1);
  },'preview');
  await test('unadapted legacy content keeps its controls and direct clicks without declaring operations',async page=>{
   await page.evaluate(()=>delete window.wallpaperApp);
   const info=await page.evaluate(()=>__SCREEN_GARDEN_GET_ACTIONS());
   assert.deepEqual(info.actions,[]);assert.equal(info.error,undefined);
   assert.equal((await invoke(page,'legacy')).code,'UNSUPPORTED');
   await page.locator('#scene-button').click({force:true});
   assert.equal(await page.evaluate(()=>sceneCount),1);
  });
  await test('ordinary browser pages work without a host object',async page=>{
   assert.equal(await page.evaluate(()=>typeof wallpaperHost),'undefined');
   await page.locator('#scene-button').click({force:true});assert.equal(await page.evaluate(()=>sceneCount),1);
  },'browser');
  console.log('\n'+passed+' real generic protocol regressions passed; zero page errors; zero external requests.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

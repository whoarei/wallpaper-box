// Real manager, sandboxed settings pages, SDK and wallpaper scenes with a native IPC fixture.
// The fixture supplies storage/window routing; Rust tests cover the production native contracts.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'../wallpaper-host/node_modules/playwright-core');
const root=path.resolve(__dirname,'..'),manager='http://tauri.localhost',wallpaper='http://wallpaper.localhost';
const wrapper=fs.readFileSync(path.join(root,'wallpaper-host/src-tauri/wallpaper-mode.js'),'utf8');
const protocol=fs.readFileSync(path.join(root,'wallpaper-host/src-tauri/src/protocol.rs'),'utf8');
const policy=protocol.match(/const CONTENT_POLICY: &str = "([^"]+)"/)[1];
const ancestors=protocol.match(/const SETTINGS_ANCESTORS: &str =\s*"([^"]+)"/)[1];
const managerPolicy=JSON.parse(fs.readFileSync(path.join(root,'wallpaper-host/src-tauri/tauri.conf.json'))).app.security.csp
 .replace('connect-src ipc:',"connect-src 'self' ipc:");
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
const copy=value=>JSON.parse(JSON.stringify(value));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'wallpaper-settings-'));
const storage=path.join(temporary,'settings.json');
const modules=['aquarium','pinewind-town'].map(id=>({
 ...JSON.parse(fs.readFileSync(path.join(root,'wallpapers',id,'module.json'))),id,
 href:`/${id}/index.html`,source:'builtin',rollback_available:false,cover:null,settings_token:id+'-v1'
}));
modules.push({id:'legacy',name:'普通网页',version:'1.0.0',href:'/legacy/index.html',description:'',tags:[],source:'local',settings:null,settings_token:'legacy'});
const state={version:'0.10.2',service:wallpaper,auto_pause:true,auto_start:true,auto_start_error:null,
 proxy:{mode:'system',url:''},wallpaper_repositories:[],selected_monitor:'primary',
 displays:[{id:'primary',name:'主显示器',width:1920,height:1080,scale:1,primary:true}],
 modules,warnings:[],downloads:[],wallpapers:[],last_error:null,online:{catalog:null,checked_at:0}};
let saved={},failSave=false,deferLoad=false,releaseLoad=null,passed=0;
const calls=[],scenes=[];
function snapshot(id){return copy(saved[id]||{revision:0,settings:{}});}
async function native(command,args={}){
 calls.push({command,args:copy(args)});
 if(command==='get_state')return copy(state);
 if(!['get_wallpaper_settings','set_wallpaper_settings'].includes(command))throw new Error('Unexpected native command: '+command);
 const module=modules.find(module=>module.id===args.moduleId);
 if(!module?.settings||module.settings_token!==args.pageToken)throw new Error('壁纸已更新，请重新打开设置页。');
 if(command==='get_wallpaper_settings'){
  if(deferLoad){deferLoad=false;await new Promise(resolve=>{releaseLoad=resolve;});}
  return snapshot(module.id);
 }
 const previous=snapshot(module.id);
 if(previous.revision!==args.expectedRevision)throw new Error('配置已发生变化，请重新加载设置后再保存。');
 if(failSave)throw new Error('壁纸配置保存失败，请检查设置目录是否可写。');
 const next={...saved,[module.id]:{revision:previous.revision+1,settings:copy(args.settings)}};
 fs.writeFileSync(storage,JSON.stringify(next));saved=next;
 const targets=scenes.filter(scene=>scene.id===module.id&&!scene.page.isClosed());
 for(const scene of targets)await scene.page.evaluate(value=>__SCREEN_GARDEN_SET_SETTINGS(value),{moduleId:module.id,...snapshot(module.id)});
 return {snapshot:snapshot(module.id),running:targets.length,pending:false};
}
async function route(context){
 await context.route('**/*',async request=>{
  const url=new URL(request.request().url());
  if(![manager,wallpaper].includes(url.origin))throw new Error('Unexpected external request: '+url);
  if(url.pathname==='/favicon.ico')return request.fulfill({status:204});
  if(url.origin===manager&&url.pathname==='/__native'){
   try{const {command,args}=request.request().postDataJSON();return request.fulfill({json:{ok:true,value:await native(command,args)}});}
   catch(error){return request.fulfill({json:{ok:false,error:String(error.message||error)}});}
  }
  let file,headers={};
  if(url.origin===manager){
   const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);
   if(!['index.html','app.js','app.css','settings.css','online.css','icon.png','window-controls.js','wallpaper-settings.js'].includes(relative))return request.fulfill({status:404});
   file=path.join(root,'wallpaper-host/ui',relative);
   if(relative==='index.html')headers['Content-Security-Policy']=managerPolicy;
  }else if(url.pathname==='/__wallpaper_host__/settings.js')file=path.join(root,'wallpaper-host/src-tauri/wallpaper-settings.js');
  else{
   const [,id,...parts]=url.pathname.split('/');
   if(!['aquarium','pinewind-town'].includes(id)||parts.some(part=>part==='..'))return request.fulfill({status:404});
   const relative=parts.join('/');file=path.join(root,'wallpapers',id,relative);
   headers['Content-Security-Policy']=relative==='settings.html'?policy.replace("frame-ancestors 'none'",ancestors):policy;
  }
  if(!fs.existsSync(file))return request.fulfill({status:404});
  let body=fs.readFileSync(file);
  if(url.origin===wallpaper&&url.pathname.endsWith('/index.html')){
   const id=url.pathname.split('/')[1];
   const script='('+wrapper+')({mode:"desktop"});__SCREEN_GARDEN_SET_SETTINGS('+JSON.stringify({moduleId:id,...snapshot(id)}).replace(/</g,'\\u003c')+');'+
    'document.addEventListener("DOMContentLoaded",()=>__SCREEN_GARDEN_SET_PAUSED({paused:false,pauseReason:"none"}),{once:true});';
   body=Buffer.from(body.toString().replace('<head>','<head><script>'+script+'</script>'));
  }
  return request.fulfill({status:200,body,headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream',...headers}});
 });
 await context.addInitScript(()=>{
  if(location.hostname!=='tauri.localhost')return;
  window.__TAURI__={core:{invoke:async(command,args={})=>{
   const reply=await(await fetch('/__native',{method:'POST',body:JSON.stringify({command,args})})).json();
   if(!reply.ok)throw new Error(reply.error);return reply.value;
  }},event:{listen:async()=>()=>{}},window:{getCurrentWindow:()=>({
   isMaximized:async()=>false,isFocused:async()=>true,onResized:async()=>()=>{},onFocusChanged:async()=>()=>{},onScaleChanged:async()=>()=>{}
  })}};
 });
}
async function test(name,body){await body();passed++;console.log('PASS '+name);}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.EDGE_PATH?{executablePath:process.env.EDGE_PATH}:{channel:'msedge'})});
 const context=await browser.newContext({viewport:{width:780,height:600},locale:'zh-CN'});
 await route(context);const page=await context.newPage();const sceneContexts=[];
 const errors=[];context.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));
 page.on('pageerror',error=>errors.push(error.message));
 const frame=()=>page.frameLocator('#wallpaper-settings-frame iframe');
 async function open(id='aquarium'){
  if(!await page.locator('#settings-dialog').evaluate(node=>node.open))await page.locator('#settings-open').click();
  await page.locator('#settings-tab-wallpaper').click();
  await page.locator('#wallpaper-settings-select').selectOption(id);
  await frame().locator('#save').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#wallpaper-settings-status').textContent.startsWith('同一设备'));
 }
 async function save(lighting,flow){
  await frame().locator('#lighting').selectOption(String(lighting));await frame().locator('#flow').selectOption(String(flow));
  await frame().locator('#save').click();
  await frame().locator('#feedback').filter({hasText:'已保存'}).waitFor();
 }
 async function start(id){
  const sceneContext=await browser.newContext({viewport:{width:960,height:600}});sceneContexts.push(sceneContext);await route(sceneContext);
  const scene=await sceneContext.newPage();scene.on('pageerror',error=>errors.push(error.message));scene.setDefaultTimeout(120000);await scene.clock.install({time:new Date('2026-11-13T04:00:00Z')});
  await scene.clock.pauseAt(new Date('2026-11-13T04:00:01Z'));await scene.goto(wallpaper+'/'+id+'/index.html');
  scenes.push({id,page:scene});return scene;
 }
 try{
  await page.goto(manager);await page.locator('.module').first().waitFor();
  await test('an installed wallpaper can save while stopped and reload the same durable configuration',async()=>{
   await open();await save(2,1);
   assert.match(await page.locator('#wallpaper-settings-status').innerText(),/下次启动/);
   assert.deepEqual(JSON.parse(fs.readFileSync(storage)).aquarium,{revision:1,settings:{lighting:2,flow:1}});
   saved=JSON.parse(fs.readFileSync(storage));await page.reload();await open();
   assert.equal(await frame().locator('#lighting').inputValue(),'2');assert.equal(await frame().locator('#flow').inputValue(),'1');
  });
  await test('wallpapers without a settings page show an empty state',async()=>{
   await page.locator('#wallpaper-settings-select').selectOption('legacy');
   assert.equal(await page.locator('#wallpaper-settings-frame iframe').count(),0);
   assert.match(await page.locator('#wallpaper-settings-empty').innerText(),/暂无自定义设置/);await open();
  });
  await test('sandboxed pages cannot access the manager or request unrelated native operations',async()=>{
   const child=page.frames().find(f=>f.url().includes('/aquarium/settings.html'));
   const isolation=await child.evaluate(()=>{
    let blocked=false;try{parent.document.body}catch{blocked=true;}
    return {blocked,native:typeof window.__TAURI__};
   });assert.deepEqual(isolation,{blocked:true,native:'undefined'});
   const before=calls.length;
   await child.evaluate(async()=>{
    const session=new URLSearchParams(location.hash.slice(1)).get('wallpaper-settings');
    parent.postMessage({channel:'wallpaper-settings-v1',session,requestId:'999',method:'quit_app'},'*');
   });
   await page.waitForTimeout(100);
   assert.equal(calls.slice(before).filter(call=>call.command==='quit_app').length,0);
   assert.equal(await child.evaluate(async()=>{
    try{await wallpaperSettings.save({large:'x'.repeat(32768)},1);return false}catch{return true;}
   }),true);
   await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:'null',data:{channel:'wallpaper-settings-v1',session:document.querySelector('iframe').src.split('=').pop(),requestId:'1',method:'save',settings:{injected:true},expectedRevision:1}})));
   assert.deepEqual(snapshot('aquarium').settings,{lighting:2,flow:1});
  });
  const first=await start('aquarium'),second=await start('aquarium'),town=await start('pinewind-town');
  await test('every new wallpaper window receives saved settings before its first animation frame',async()=>{
   for(const scene of [first,second]){
    const info=await scene.evaluate(()=>({settings:wallpaperHost.getSettings(),state:aquarium.getState()}));
    assert.deepEqual(info.settings,{lighting:2,flow:1});assert.equal(info.state.lighting,2);assert.equal(info.state.flow,1);
   }
  });
  await test('one save updates both running screens while paused without changing another wallpaper',async()=>{
   for(const scene of [first,second])await scene.evaluate(()=>__SCREEN_GARDEN_SET_PAUSED({paused:true,pauseReason:'manual'}));
   const time=await first.evaluate(()=>aquarium.getState().time);await save(1,2);
   for(const scene of [first,second]){
    assert.deepEqual(await scene.evaluate(()=>wallpaperHost.getSettings()),{lighting:1,flow:2});
    assert.equal(await scene.evaluate(()=>aquarium.getState().flow),2);
    assert.equal(await scene.evaluate(()=>wallpaperHost.getState().paused),true);
   }
   assert.equal(await first.evaluate(()=>aquarium.getState().time),time);
   assert.deepEqual(await town.evaluate(()=>wallpaperHost.getSettings()),{});
   assert.match(await page.locator('#wallpaper-settings-status').innerText(),/已通知/);
  });
  await test('older revisions, other wallpaper updates and mutated event snapshots cannot overwrite current settings',async()=>{
   const result=await first.evaluate(()=>{
    const original=wallpaperHost.getSettings();original.lighting=99;
    __SCREEN_GARDEN_SET_SETTINGS({moduleId:'aquarium',revision:1,settings:{lighting:0}});
    __SCREEN_GARDEN_SET_SETTINGS({moduleId:'pinewind-town',revision:99,settings:{lighting:0}});
    window.addEventListener('wallpaperhost:settingschange',event=>{event.detail.settings.lighting=88;},{once:true});
    __SCREEN_GARDEN_SET_SETTINGS({moduleId:'aquarium',revision:3,settings:{lighting:2,flow:0}});
    return wallpaperHost.getSettings();
   });assert.deepEqual(result,{lighting:2,flow:0});
  });
  await test('failed writes and stale settings revisions retain the saved values',async()=>{
   const child=page.frames().find(f=>f.url().includes('/aquarium/settings.html'));
   assert.match(await child.evaluate(async()=>{try{await wallpaperSettings.save({},0);return ''}catch(e){return e.message;}}),/配置已发生变化/);
   const before=fs.readFileSync(storage,'utf8');failSave=true;
   await frame().locator('#lighting').selectOption('0');await frame().locator('#save').click();
   await frame().locator('#error').filter({hasText:'保存失败'}).waitFor();failSave=false;
   assert.equal(fs.readFileSync(storage,'utf8'),before);
  });
  await test('late replies from a replaced settings frame never update the new wallpaper page',async()=>{
   deferLoad=true;await page.locator('#wallpaper-settings-select').selectOption('pinewind-town');
   for(let attempt=0;!releaseLoad&&attempt<500;attempt++)await page.waitForTimeout(20);
   assert.equal(typeof releaseLoad,'function','The old settings request must reach the native fixture');
   await page.locator('#wallpaper-settings-select').selectOption('aquarium');releaseLoad();releaseLoad=null;
   await page.waitForFunction(()=>document.querySelector('#wallpaper-settings-status').textContent.startsWith('同一设备'));
   assert.equal(await frame().locator('#lighting').inputValue(),'1');
   await page.locator('#wallpaper-settings-select').selectOption('pinewind-town');
   await frame().locator('#raining').selectOption('1');await frame().locator('#phase').selectOption('3');
   await frame().locator('#save').click();
   await frame().locator('#feedback').filter({hasText:'已保存'}).waitFor();
   assert.deepEqual(await town.evaluate(()=>wallpaperHost.getSettings()),{phase:3,raining:true});
   assert.equal(await town.evaluate(()=>pinewind.getState().phase),3);
   assert.equal(await town.evaluate(()=>pinewind.getState().raining),true);
   assert.deepEqual(snapshot('aquarium').settings,{lighting:1,flow:2});
  });
  await test('settings stay usable across normal and compact layouts and package updates remount the frame',async()=>{
   for(const [width,height] of [[1080,760],[780,600],[390,844]]){
    await page.setViewportSize({width,height});
    const bounds=await page.locator('#wallpaper-settings-frame iframe').boundingBox();
    assert.ok(bounds.width>200&&bounds.height>150,JSON.stringify(bounds));
    assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height);
    assert.ok(await frame().locator('#save').isVisible());
    if(process.env.ARTIFACTS_DIR){fs.mkdirSync(process.env.ARTIFACTS_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.ARTIFACTS_DIR,`wallpaper-settings-${width}.png`)});}
   }
   const old=await page.locator('iframe').getAttribute('src');modules[1].settings_token='pinewind-town-v2';
   await page.waitForFunction(old=>document.querySelector('iframe')?.src!==old,old);
   await frame().locator('#save').waitFor({state:'visible'});
   assert.notEqual(await page.locator('iframe').getAttribute('src'),old);
  });
  assert.deepEqual(errors,[]);console.log('\n'+passed+' wallpaper settings integration checks passed.');
 }catch(error){
  console.error('Page errors:',errors);
  console.error('Settings diagnostics:',await page.locator('#wallpaper-settings-status').textContent(),calls.filter(call=>call.command!=='get_state').slice(-8));
  await page.screenshot({path:path.join(os.tmpdir(),'wallpaper-settings-failure.png')});throw error;
 }finally{for(const sceneContext of sceneContexts)await sceneContext.close();await context.close();await browser.close();fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});

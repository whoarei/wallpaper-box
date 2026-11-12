// Real module compatibility in desktop, preview, browser and legacy contexts.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'../wallpaper-host/node_modules/playwright-core');
const {bootstrap}=require('./wallpaper-test-support.cjs');
const root=path.resolve(process.env.WALLPAPER_ROOT||path.join(__dirname,'../wallpapers'));
const source=fs.readFileSync(path.join(__dirname,'../wallpaper-host/src-tauri/wallpaper-mode.js'),'utf8');
const modules=[
 {id:'pinewind-town',dock:'.dock',pause:'#pause-scene',actions:['phase','weather','train']},
 {id:'aquarium',dock:'.controls',pause:'#pause',actions:['feed','light','flow']}
];
(async()=>{
 const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.pathname==='/favicon.ico'){response.writeHead(204).end();return;}
  const [,id,file]=url.pathname.split('/');
  if(!modules.some(module=>module.id===id)||!['index.html','wallpaper-adapter.js','aquarium.js','aquarium.css'].includes(file)){
   response.writeHead(404).end();return;
  }
  let body=fs.readFileSync(path.join(root,id,file));
  if(file==='index.html'){
   const mode=url.searchParams.get('mode');
   let script='';
   if(mode==='desktop'||mode==='preview')script=bootstrap(source,mode);
   if(mode==='legacy')script='document.addEventListener("DOMContentLoaded",()=>{document.documentElement.dataset.screenGardenWallpaper="true"},{once:true});';
   const legacy=mode==='legacy'?'<style>.hud,.overlay,.toast,.help-panel,.pause-badge{display:none!important}</style>':'';
   body=body.toString().replace('<head>','<head>'+legacy+(script?'<script>'+script+'</script>':''));
  }
  response.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html;charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript'});
  response.end(body);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.EDGE_PATH?{executablePath:process.env.EDGE_PATH}:{channel:'msedge'})});
 let passed=0;
 try{
  for(const module of modules)for(const mode of ['desktop','preview','browser','legacy']){
   const context=await browser.newContext({viewport:{width:960,height:600}}),page=await context.newPage(),errors=[],external=[];
   page.on('pageerror',error=>errors.push(error.message));
   await context.route('**/*',route=>{
    if(new URL(route.request().url()).origin!==address){external.push(route.request().url());return route.abort();}
    return route.continue();
   });
   // Freeze before navigation, as the physics suite does: software canvas
   // rendering must not monopolize the renderer while waiting for page load.
   page.setDefaultTimeout(120000);
   const start=new Date('2026-11-12T00:00:00Z');
   await page.clock.install({time:start});
   await page.clock.pauseAt(new Date(start.getTime()+1000));
   await page.goto(address+'/'+module.id+'/index.html?mode='+mode);
   await page.clock.runFor(100);
   try{
    assert.equal(await page.locator(module.dock).isVisible(),true);
    assert.equal(await page.locator('#fullscreen').isVisible(),mode==='preview'||mode==='browser');
    assert.equal(await page.locator('html').getAttribute('data-wallpaper-mode'),mode==='legacy'?'desktop':mode);
    const declared=await page.evaluate(()=>wallpaperApp.getActions());
    assert.deepEqual(declared.map(action=>action.id),mode==='desktop'?module.actions:[]);
    if(mode==='desktop'){
     const result=await page.evaluate(actionId=>{
      const request={protocolVersion:1,instanceId:wallpaperHost.instanceId,requestId:'once',actionId};
      return {first:__SCREEN_GARDEN_INVOKE_ACTION(request).result,repeat:__SCREEN_GARDEN_INVOKE_ACTION(request).result};
     },module.actions[0]);
     assert.equal(result.first.ok,true);assert.deepEqual(result.repeat,result.first);
     await page.evaluate(selector=>document.querySelector(selector).click(),module.pause);
     assert.ok((await page.evaluate(()=>wallpaperApp.getActions())).every(action=>!action.enabled));
     await page.evaluate(()=>{
      __SCREEN_GARDEN_SET_PAUSED({paused:true,pauseReason:'manual'});
      __SCREEN_GARDEN_SET_PAUSED({paused:false,pauseReason:'none'});
     });
     assert.ok((await page.evaluate(()=>wallpaperApp.getActions())).every(action=>!action.enabled),'Host resume must preserve the page pause');
     await page.evaluate(selector=>document.querySelector(selector).click(),module.pause);
     assert.ok((await page.evaluate(()=>wallpaperApp.getActions())).every(action=>action.enabled));
     await page.clock.fastForward(10000);
     assert.equal(await page.locator('body').evaluate(body=>body.classList.contains('idle')),true);
     await page.evaluate(()=>__SCREEN_GARDEN_DESKTOP_MOVE(.4,.5));
     assert.equal(await page.locator('body').evaluate(body=>body.classList.contains('idle')),false);
     for(const viewport of [{width:320,height:600},{width:700,height:1000},{width:1600,height:900}]){
      await page.setViewportSize(viewport);
      const bounds=await page.locator(module.dock).evaluate(dock=>{
       for(const animation of dock.getAnimations())animation.finish();
       const r=dock.getBoundingClientRect();
       return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,
        labels:[...dock.querySelectorAll('em,b')].map(label=>getComputedStyle(label).display)};
      });
      assert.ok(bounds.left>=-1&&bounds.right<=viewport.width+1&&bounds.top>=0&&bounds.bottom<=viewport.height+1,JSON.stringify({viewport,bounds}));
      assert.ok(bounds.labels.every(display=>display!=='none'),'Desktop operation names do not rely on hover tooltips');
      if(process.env.ARTIFACTS_DIR&&viewport.width!==700){
       fs.mkdirSync(process.env.ARTIFACTS_DIR,{recursive:true});
       await page.screenshot({path:path.join(process.env.ARTIFACTS_DIR,module.id+'-'+viewport.width+'.png')});
      }
     }
    }
    if(mode==='legacy'){
     await page.clock.fastForward(10000);
     assert.equal(await page.locator('body').evaluate(body=>body.classList.contains('idle')),false);
     assert.equal(await page.evaluate(()=>typeof wallpaperHost),'undefined');
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    passed++;console.log('PASS '+module.id+' '+mode+' ('+root+')');
   }finally{await context.close();}
  }
  console.log('\n'+passed+' real module compatibility checks passed.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

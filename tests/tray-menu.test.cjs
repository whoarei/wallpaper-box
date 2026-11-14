// Exercise the actual tray document with a menu-scoped native IPC fixture.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'../wallpaper-host/node_modules/playwright-core');
const root=path.resolve(__dirname,'../wallpaper-host/ui');
const entry=(id,label,icon='image',enabled=true,checked=null,children=[])=>({id,label,icon,enabled,checked,children});
const separator=()=>entry('','','',false);
function model(){return {generation:1,locale:'zh-CN',brand:'壁纸盒子',version:require('../wallpaper-host/package.json').version,display:'DISPLAY1 · 主显示器',wallpaper:'水族箱',status:'播放中',playing:true,items:[
 entry('open-manager','打开壁纸管理','grid'),separator(),
 entry('displays','选择显示器','monitor',true,null,[entry('display:primary','DISPLAY1 · 主显示器','monitor',true,true),entry('display:secondary','DISPLAY2','monitor',true,false)]),
 entry('wallpapers','壁纸','image',true,null,[entry('wallpaper:aquarium','水族箱','image',true,true),entry('wallpaper:town','松风镇','image',true,false),separator(),
  entry('wallpaper-actions','壁纸操作','sparkles',true,null,[entry('action:document:feed','投喂鱼儿','sparkles'),entry('action:document:disabled','冷却中','sparkles',false),separator(),entry('pause-current','暂停当前壁纸','pause',true,false),entry('remove-current','关闭当前屏幕壁纸','close')])]),
 entry('pause-all','暂停全部壁纸','pause'),separator(),entry('open-settings','设置','settings'),entry('auto-pause','遮挡时自动暂停','auto-pause',true,true),
 entry('check-app-update','检查程序更新','refresh'),entry('about','关于壁纸盒子','info'),separator(),entry('quit','退出壁纸盒子','power')
]};}
function fixture(initial){
 const listeners=new Map(),calls=[];let state=initial,hold=false,pendingAction=null,pendingState=null;
 window.__trayTest={calls,emit:name=>listeners.get(name)?.({}),set:next=>{state=next;},state:()=>state,
  holdAction:()=>{hold=true;},rejectAction:()=>{pendingAction.reject('菜单操作已失效，请重新打开菜单。');hold=false;},
  holdState:()=>{pendingState={};},releaseState:()=>{pendingState.resolve();pendingState=null;}};
 window.__TAURI__={event:{listen:async(name,handler)=>{listeners.set(name,handler);return()=>listeners.delete(name);}},core:{invoke:async(command,args)=>{
  calls.push({command,args});
  if(command==='tray_menu_state'){
   const value=structuredClone(state);
   if(pendingState&&!pendingState.resolve)await new Promise(resolve=>{pendingState.resolve=resolve;});
   return value;
  }
  if(command==='tray_menu_action'&&hold)return new Promise((resolve,reject)=>{pendingAction={resolve,reject};});
  if(!['tray_menu_action','tray_menu_hide','tray_menu_ready'].includes(command))throw Error('Unexpected IPC: '+command);
 }}};
}
const server=http.createServer((request,response)=>{
 const file=new URL(request.url,'http://localhost').pathname.slice(1)||'tray-menu.html';
 if(file==='favicon.ico'){response.writeHead(204).end();return;}
 if(!['tray-menu.html','tray-menu.css','tray-menu.js','icon.png'].includes(file)){response.writeHead(404).end();return;}
 response.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'text/html');
 response.end(fs.readFileSync(path.join(root,file)));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=`http://127.0.0.1:${server.address().port}`,errors=[];
 const executablePath=process.env.EDGE_PATH||[process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES].filter(Boolean).map(base=>path.join(base,'Microsoft/Edge/Application/msedge.exe')).find(file=>fs.existsSync(file));
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 let passed=0;
 const row=(page,id)=>page.locator(`[data-id="${id}"]`);
 async function test(name,body,configure){
  const context=await browser.newContext({viewport:{width:320,height:548}}),page=await context.newPage();
  page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>new URL(route.request().url()).origin===address?route.continue():route.abort());
  const state=model();if(configure)configure(state);await page.addInitScript(fixture,state);
  try{
   await page.goto(address);await page.waitForFunction(()=>window.__trayTest.calls.some(call=>call.command==='tray_menu_ready'));
   await body(page);assert.deepEqual(errors,[]);console.log('PASS '+name);passed++;
  }finally{await context.close();}
 }
 async function screenshot(page,name){if(!process.env.UI_SCREENSHOT_DIR)return;fs.mkdirSync(process.env.UI_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,name+'.png')});}
 try{
  await test('main menu exposes settings, automatic pause, updates and about directly',async page=>{
   assert.deepEqual(await page.locator('#menu button').evaluateAll(rows=>rows.map(row=>row.dataset.id)),['open-manager','displays','wallpapers','pause-all','open-settings','auto-pause','check-app-update','about','quit']);
   assert.equal(await row(page,'auto-pause').getAttribute('aria-checked'),'true');
   assert.equal(await row(page,'open-manager').evaluate(node=>node===document.activeElement),true);
   assert.equal(await page.locator('#menu').evaluate(node=>node.scrollHeight<=node.clientHeight),true,'All primary items fit without scrolling');
   await screenshot(page,'tray-menu');
   await row(page,'open-settings').click();
   assert.deepEqual(await page.evaluate(()=>window.__trayTest.calls.filter(call=>call.command==='tray_menu_action')),[{command:'tray_menu_action',args:{id:'open-settings',generation:1}}]);
  });
  await test('nested wallpaper operations retain instance ids and disabled actions',async page=>{
   await row(page,'wallpapers').click();assert.equal(await row(page,'wallpaper:aquarium').getAttribute('aria-checked'),'true');
   await row(page,'wallpaper-actions').click();assert.equal(await row(page,'action:document:disabled').isDisabled(),true);
   await screenshot(page,'tray-wallpaper-actions');
   await row(page,'action:document:feed').click();
   assert.deepEqual(await page.evaluate(()=>window.__trayTest.calls.filter(call=>call.command==='tray_menu_action')),[{command:'tray_menu_action',args:{id:'action:document:feed',generation:1}}]);
  });
  await test('keyboard navigation opens, returns, skips disabled rows and dismisses',async page=>{
   await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowRight');
   assert.equal(await row(page,'display:primary').evaluate(node=>node===document.activeElement),true);
   await page.keyboard.press('End');assert.equal(await row(page,'display:secondary').evaluate(node=>node===document.activeElement),true);
   await page.keyboard.press('ArrowLeft');assert.equal(await row(page,'displays').evaluate(node=>node===document.activeElement),true);
   await row(page,'wallpapers').click();await row(page,'wallpaper-actions').click();await page.keyboard.press('ArrowDown');
   assert.equal(await row(page,'pause-current').evaluate(node=>node===document.activeElement),true);
   await page.keyboard.press('Tab');await page.keyboard.press('Tab');assert.equal(await page.locator('#back').evaluate(node=>node===document.activeElement),true);
   await page.locator('#back').click();assert.equal(await row(page,'wallpaper-actions').evaluate(node=>node===document.activeElement),true);
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>window.__trayTest.calls.filter(call=>call.command==='tray_menu_hide').length),1);
  });
  await test('state refresh preserves focused submenus and reopening resets the path and generation',async page=>{
   await row(page,'displays').click();await row(page,'display:secondary').focus();
   await page.evaluate(()=>{window.__trayTest.state().items.find(item=>item.id==='displays').children[1].label='副显示器';window.__trayTest.emit('tray-menu-updated');});
   await page.waitForFunction(()=>document.activeElement?.textContent==='副显示器');
   await page.evaluate(()=>{window.__trayTest.state().generation=2;window.__trayTest.state().playing=false;window.__trayTest.state().status='已暂停';window.__trayTest.emit('tray-menu-open');});
   await page.waitForFunction(()=>window.__trayTest.calls.some(call=>call.command==='tray_menu_ready'&&call.args.generation===2));
   assert.equal(await page.locator('#submenu-nav').isVisible(),false);assert.equal(await page.locator('#status').textContent(),'已暂停');
   await row(page,'auto-pause').click();assert.equal(await page.evaluate(()=>window.__trayTest.calls.at(-1).args.generation),2);
  });
  await test('late state responses cannot overwrite a newer menu opening',async page=>{
   await page.evaluate(()=>{window.__trayTest.holdState();window.__trayTest.emit('tray-menu-updated');});
   await page.evaluate(()=>{window.__trayTest.state().generation=3;window.__trayTest.state().wallpaper='新壁纸';window.__trayTest.emit('tray-menu-open');});
   await page.waitForFunction(()=>document.getElementById('wallpaper').textContent==='新壁纸');
   await page.evaluate(()=>window.__trayTest.releaseState());
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await page.locator('#wallpaper').textContent(),'新壁纸');
  });
  await test('pending actions prevent duplicate dispatch and failures are visible without replay',async page=>{
   await page.evaluate(()=>window.__trayTest.holdAction());
   await row(page,'check-app-update').dblclick();
   assert.equal(await page.evaluate(()=>window.__trayTest.calls.filter(call=>call.command==='tray_menu_action').length),1);
   await page.evaluate(()=>window.__trayTest.rejectAction());await page.locator('#menu-error').waitFor({state:'visible'});
   assert.match(await page.locator('#menu-error').textContent(),/操作已失效/);
   await row(page,'about').click();assert.equal(await page.evaluate(()=>window.__trayTest.calls.filter(call=>call.command==='tray_menu_action').length),2);
  });
  await test('untrusted and long wallpaper labels stay text and scroll inside the popup',async page=>{
   await row(page,'wallpapers').click();assert.equal(await page.locator('#menu b').count(),0);
   assert.match(await row(page,'wallpaper:aquarium').textContent(),/<b>/);
   for(const [width,height] of [[320,548],[320,360],[280,420]]){
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true);
    await row(page,'wallpaper-actions').scrollIntoViewIfNeeded();await row(page,'wallpaper-actions').click();await page.locator('#back').click();
   }
   await screenshot(page,'tray-small-screen');
  },state=>{state.wallpaper='长标题'.repeat(80);state.items.find(item=>item.id==='wallpapers').children[0].label='<b>点亮</b>'+('很长的壁纸名称'.repeat(60));});
  await test('English labels, typeahead and current playback fit the popup',async page=>{
   await page.keyboard.type('set');assert.equal(await row(page,'open-settings').evaluate(node=>node===document.activeElement),true);
   assert.equal(await page.locator('html').getAttribute('lang'),'en');
   assert.equal(await page.locator('#menu').evaluate(node=>node.scrollHeight<=node.clientHeight),true);
   await screenshot(page,'tray-menu-en');
  },state=>{state.locale='en';state.brand='Wallpaper Box';state.display='DISPLAY1 · Primary display';state.wallpaper='Stillwater Aquarium';state.status='Playing';const labels=['Open wallpaper manager','','Select display','Wallpapers','Pause all wallpapers','','Settings','Pause when covered','Check for app updates','About Wallpaper Box','','Quit Wallpaper Box'];state.items.forEach((item,i)=>{item.label=labels[i];});});
  console.log(`Passed ${passed} tray menu contracts.`);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});

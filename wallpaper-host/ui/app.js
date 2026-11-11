(() => {
'use strict';
const invoke=window.__TAURI__.core.invoke,$=id=>document.getElementById(id);
let state=null,localBusy=false,remoteBusy=false,activeTab='local',lastDisplays='',lastModules='',toastTimer,localError='',remoteError='';
let appUpdateBusy=false,appUpdateError='',lastAppPhase='',confirmAppVersion=null,previewBusy=false,renderEpoch=0,lastCurrentArt='',polling=false,refreshRequested=false,taskFilter=false;
const pendingTasks=new Set();
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
function current(){return state?.wallpapers.find(w=>w.display_id===state.selected_monitor);}
function toast(message){
 const node=$('toast');node.textContent=message;
 // Keep feedback visible above a modal settings/import dialog without taking focus.
 if(node.showPopover){if(node.matches(':popover-open'))node.hidePopover();node.showPopover();}
 node.classList.add('show');clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>{node.classList.remove('show');if(node.hidePopover&&node.matches(':popover-open'))node.hidePopover();},3500);
}
function compare(a,b){
 const parse=value=>{const v=String(value||'0.0.0').split('+')[0],dash=v.indexOf('-');return {core:(dash<0?v:v.slice(0,dash)).split('.').map(BigInt),pre:dash<0?[]:v.slice(dash+1).split('.')};};
 const x=parse(a),y=parse(b);for(let i=0;i<3;i++){if(x.core[i]!==y.core[i])return x.core[i]>y.core[i]?1:-1;}
 if(!x.pre.length||!y.pre.length)return x.pre.length===y.pre.length?0:x.pre.length?-1:1;
 for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){
  const l=x.pre[i],r=y.pre[i];if(l===r)continue;if(l===undefined)return -1;if(r===undefined)return 1;
  const ln=/^\d+$/.test(l),rn=/^\d+$/.test(r);if(ln&&rn)return BigInt(l)>BigInt(r)?1:-1;if(ln!==rn)return ln?-1:1;return l>r?1:-1;
 }return 0;
}
function bytes(n){n=Math.max(0,Number(n)||0);if(!n)return '0 KB';return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(n/1024))+' KB';}
function image(card,url,name){if(!url){card.append(el('div','cover-fallback',name));return;}const img=el('img','cover');img.src=url;img.alt=name+'封面';img.referrerPolicy='no-referrer';img.onerror=()=>img.replaceWith(el('div','cover-fallback',name));card.append(img);}
const downloadTasks=()=>state?.downloads||[];
const downloadTask=id=>downloadTasks().find(task=>task.id===id);
function reconcile(container,items,key,signature,build){
 const old=new Map([...container.children].map(card=>[card.dataset.cardKey,card]));
 items.forEach((item,index)=>{
  const id=key(item),sig=signature(item);let card=old.get(id);old.delete(id);
  if(!card||card.dataset.signature!==sig){const next=build(item);next.dataset.cardKey=id;next.dataset.signature=sig;if(card)card.replaceWith(next);card=next;}
  if(container.children[index]!==card)container.insertBefore(card,container.children[index]||null);
 });
 old.forEach(card=>card.remove());
}
function taskSlot(card,id){const slot=el('div','download-task');slot.dataset.downloadId=id;slot.hidden=true;card.append(slot);}
function renderDownloads(){
 const tasks=downloadTasks(),count=phase=>tasks.filter(t=>t.phase===phase).length;
 const processing=tasks.filter(t=>['verifying','waiting_install','installing','cancelling'].includes(t.phase)).length;
 const parts=[];if(count('downloading'))parts.push('下载中 '+count('downloading'));if(processing)parts.push('处理中 '+processing);if(count('queued'))parts.push('等待 '+count('queued'));if(count('failed'))parts.push('失败 '+count('failed'));
 $('download-filter').hidden=!tasks.length&&!taskFilter;$('download-filter').textContent=parts.join(' · ')||'显示全部壁纸';$('download-filter').title=(parts.join(' · ')||'当前没有任务')+'。最多 5 项并行，点击筛选相关壁纸';$('download-filter').setAttribute('aria-pressed',String(taskFilter));$('download-filter').classList.toggle('has-errors',!!count('failed'));
 $('clear-download-filter').hidden=!taskFilter;
 for(const slot of document.querySelectorAll('[data-download-id]')){
  const id=slot.dataset.downloadId,task=downloadTask(id);slot.hidden=!task;
  const card=slot.closest('.module'),normal=card.querySelector('.download');if(normal)normal.hidden=!!task;
  if(!task)continue;
  if(slot.dataset.phase!==task.phase){
   slot.dataset.phase=task.phase;slot.className='download-task '+task.phase;slot.replaceChildren();
   const meter=el('div','task-meter'),heading=el('div','task-heading'),label=el('span','task-label'),percentage=el('span','task-percentage');heading.append(label,percentage);
   const progress=el('progress','task-progress');progress.max=100;progress.setAttribute('aria-label',task.item.name+'下载进度');
   const meta=el('div','task-meta'),size=el('span','task-size'),speed=el('span','task-speed');meta.append(size,speed);meter.append(heading,progress,meta);
   const tools=el('div','task-tools'),action=el('button','task-action'),dismiss=el('button','task-dismiss','×');
   const failed=task.phase==='failed';action.textContent=failed?'重试':task.phase==='queued'?'移出':'取消';action.classList.toggle('retry',failed);action.setAttribute('aria-label',(failed?'重试':task.phase==='queued'?'移出队列：':'取消下载：')+task.item.name);action.onclick=()=>changeDownload(id,failed?'retry':'cancel');
   action.hidden=!['downloading','queued','failed'].includes(task.phase);dismiss.hidden=!failed;dismiss.title='移除失败记录';dismiss.setAttribute('aria-label','移除失败记录：'+task.item.name);dismiss.onclick=()=>changeDownload(id,'cancel');tools.append(action,dismiss);slot.append(meter,tools);
  }
  const phase=task.phase,p=Math.max(0,Math.min(100,task.total?task.received/task.total*100:0));
  const labels={queued:'等待中',downloading:'正在下载',cancelling:'正在取消',verifying:'校验中',waiting_install:'等待安装',installing:'安装中',failed:'下载失败'};
  slot.querySelector('.task-label').textContent=labels[phase]||'处理中';slot.querySelector('.task-percentage').textContent=phase==='downloading'?Math.floor(p)+'%':'';
  const progress=slot.querySelector('progress');progress.value=p;progress.hidden=['queued','failed','cancelling'].includes(phase);progress.setAttribute('aria-valuetext',phase==='downloading'?Math.floor(p)+'%':labels[phase]||'处理中');
  slot.querySelector('.task-size').textContent=phase==='queued'?'空出位置后自动开始':phase==='failed'?task.error||'下载中断，请重试':phase==='cancelling'?'正在停止连接，保留已安装壁纸':phase==='downloading'?bytes(task.received)+' / '+bytes(task.total):phase==='verifying'?'下载完成，正在校验':phase==='waiting_install'?'校验通过，等待保存到本机':'正在保存到本机';
  slot.querySelector('.task-size').title=task.error||'';slot.querySelector('.task-speed').textContent=phase==='queued'?'第 '+task.queue_position+' 项':phase==='downloading'&&task.speed?bytes(task.speed)+'/s':'';
  slot.querySelectorAll('button').forEach(button=>button.disabled=pendingTasks.has(id));
 }
}
async function changeDownload(moduleId,action='enqueue'){
 if(pendingTasks.has(moduleId))return;pendingTasks.add(moduleId);const epoch=++renderEpoch;renderBusy();
 try{const result=await invoke(action==='enqueue'?'install_online':'download_action',action==='enqueue'?{moduleId}:{moduleId,action});if(result&&epoch===renderEpoch)render(result);}
 catch(error){toast(String(error));}
 finally{renderEpoch++;pendingTasks.delete(moduleId);renderBusy();update();}
}
function appUpdate(){return state?.app_update||{phase:'idle',current_version:state?.version,version:null};}
function showDialog(id){const dialog=$(id);if(!dialog.open)dialog.showModal();}
function openAppUpdate(){showDialog('settings-dialog');$('app-update-panel').scrollIntoView({block:'nearest'});}
function closePlaybackMenu(){$('playback-menu').open=false;}
async function direct(command,args={},message=''){
 try{await invoke(command,args);if(message)toast(message);}catch(error){toast(String(error));}
}
async function previewWallpaper(moduleId){
 if(previewBusy)return;
 previewBusy=true;renderBusy();
 try{await invoke('preview_wallpaper',{moduleId});}
 catch(error){localError=String(error);toast(localError);if(state)render(state);}
 finally{previewBusy=false;renderBusy();}
}
function applyWallpaper(moduleId){
 if(!state||current()?.module_id===moduleId)return;
 const monitor=state.displays.find(d=>d.id===state.selected_monitor);
 if(monitor)run('apply_wallpaper',{monitorId:monitor.id,moduleId},'已应用到 '+monitor.name);
}
function moduleDetails(module){
 const details=el('details','module-details');details.append(el('summary','','详情'));
 details.append(el('div','module-meta',`${({builtin:'内置',online:'已下载',local:'本地'})[module.source]||'本地'} · v${module.version}`),el('p','module-description',module.description));
 if(module.rollback_available){const rollback=el('button','rollback text-button','切换到上一版本');rollback.dataset.moduleId=module.id;rollback.onclick=()=>run('rollback_wallpaper',{moduleId:module.id},'已切换版本',true);details.append(rollback);}
 return details;
}
function renderAppUpdate(){
 const update=appUpdate(),phase=update.phase||'idle',ready=phase==='ready',working=['checking','downloading','installing'].includes(phase);
 $('version').textContent=update.current_version||state?.version||'';
 $('app-update-latest-wrap').hidden=!update.version;$('app-update-latest').textContent=update.version||'';
 $('app-update-toggle').hidden=!ready;
 const status={idle:'自动检查更新已开启。',checking:'正在检查程序更新…',downloading:'正在后台下载，完成后将验证安装包。',ready:`v${update.version||''} 已下载并验证，可以重启升级。`,up_to_date:'已是最新版本。',installing:'正在启动安装程序…',error:'程序更新暂时未能完成。'};
 let description=status[phase]||status.idle;
 if(update.last_checked_at)description+=' 上次检查 '+new Date(update.last_checked_at*1000).toLocaleString('zh-CN');
 $('app-update-status').textContent=description;
 $('app-update-progress-wrap').hidden=phase!=='downloading';
 const received=Math.max(0,Number(update.received)||0),total=Number(update.total)||0;
 if(total>0)$('app-update-progress').value=Math.min(100,received/total*100);else $('app-update-progress').removeAttribute('value');
 $('app-update-size').textContent=(received?bytes(received):'0 KB')+' / '+(total>0?bytes(total):'正在获取大小');
 const error=appUpdateError||update.error||'';$('app-update-error').hidden=!error;$('app-update-error').textContent=error;
 $('app-update-notes-wrap').hidden=!update.notes;$('app-update-notes').textContent=update.notes||'';
 $('check-app-update').disabled=appUpdateBusy||working;
 $('download-app-update').hidden=phase!=='error'||!update.version;$('download-app-update').disabled=appUpdateBusy||working;
 $('install-app-update').hidden=!ready;$('install-app-update').disabled=appUpdateBusy||!ready;
 $('confirm-app-update').disabled=appUpdateBusy||!ready;
 if(ready&&lastAppPhase!=='ready')toast('新版已就绪，可在设置中重启升级。');
 lastAppPhase=phase;
}
async function runAppUpdate(command,args={}){
 if(appUpdateBusy)return;
 appUpdateBusy=true;const epoch=++renderEpoch;appUpdateError='';renderAppUpdate();
 try{const result=await invoke(command,args);if(result&&epoch===renderEpoch)render(result);}
 catch(error){appUpdateError=String(error);}
 finally{renderEpoch++;appUpdateBusy=false;renderAppUpdate();}
}
async function run(command,args={},message='',remote=false){
 if(remote?remoteBusy:localBusy)return;
 const epoch=++renderEpoch;
 if(remote){remoteBusy=true;remoteError='';}else{localBusy=true;localError='';}
 renderBusy();
 try{const result=await invoke(command,args);if(result){if(epoch===renderEpoch)render(result);if(message)toast(message);}return result;}
 catch(error){if(remote){remoteError=String(error);}else{localError=String(error);}toast(String(error));}
 finally{renderEpoch++;if(remote)remoteBusy=false;else localBusy=false;lastModules='';if(state)render(state);renderBusy();}
}
function renderBusy(){
 const playing=current(),hasMonitor=!!state?.displays.some(d=>d.id===state.selected_monitor);
 $('feed-aquarium').disabled=localBusy||!playing||playing.paused;
 for(const id of ['pause','remove','preview','reload'])$(id).disabled=localBusy||!playing;
 $('show-desktop').disabled=localBusy||!hasMonitor;
 $('displays').disabled=localBusy||!state?.displays.length;
 $('auto-pause').disabled=localBusy||!state;
 $('refresh').disabled=localBusy;
 $('check-online').disabled=remoteBusy;
 $('check-online').textContent=remoteBusy?'正在刷新…':'刷新壁纸库';
 for(const id of ['import-open','import-folder','import-zip'])$(id).disabled=localBusy;
 document.querySelectorAll('.apply,.apply-cover').forEach(button=>button.disabled=localBusy||button.dataset.available==='false');
 document.querySelectorAll('.rollback').forEach(button=>{const task=downloadTask(button.dataset.moduleId);button.disabled=remoteBusy||pendingTasks.has(button.dataset.moduleId)||(!!task&&task.phase!=='failed')||button.dataset.available==='false';});
 document.querySelectorAll('.download').forEach(button=>button.disabled=(button.dataset.actionApply==='true'&&localBusy)||pendingTasks.has(button.dataset.moduleId)||button.dataset.available==='false');
 document.querySelectorAll('[data-download-id] button').forEach(button=>button.disabled=pendingTasks.has(button.closest('[data-download-id]').dataset.downloadId));
 document.querySelectorAll('.wallpaper-preview').forEach(button=>button.disabled=previewBusy);
}
function render(data){
 state=data;$('version').textContent=data.version;renderAppUpdate();
 const monitor=data.displays.find(d=>d.id===data.selected_monitor),playing=current();
 const visibleError=localError||data.last_error||(activeTab==='local'?remoteError:'');$('error').hidden=!visibleError;$('error').textContent=visibleError;
 $('auto-pause').checked=data.auto_pause;
 $('current-title').textContent=playing?playing.name:'该屏幕尚未设置动态壁纸';
 $('current-status').textContent=playing?(playing.paused?'已暂停':playing.auto_paused?'遮挡，自动暂停':'正在播放'):'';
 $('status-dot').classList.toggle('playing',!!playing&&!playing.paused&&!playing.auto_paused);
 $('pause').hidden=!playing;$('pause').textContent=playing?.paused?'继续':'暂停';$('pause').dataset.paused=String(!!playing?.paused);
 $('current-monitor').textContent=monitor?.name||'没有可用的显示器';
 const currentModule=data.modules.find(m=>m.id===playing?.module_id),artUrl=currentModule?.cover?data.service+currentModule.cover:'';
 const artSig=JSON.stringify([currentModule?.id,artUrl]);
 if(artSig!==lastCurrentArt){$('current-art').replaceChildren();if(artUrl){const img=el('img');img.src=artUrl;img.alt='';img.onerror=()=>img.replaceWith(el('span','','▱'));$('current-art').append(img);}else $('current-art').append(el('span','','▱'));lastCurrentArt=artSig;}
 $('feed-aquarium').hidden=playing?.module_id!=='aquarium';
 $('module-count').textContent=String(data.modules.length).padStart(2,'0');
 const displaySig=JSON.stringify([data.displays,data.selected_monitor]);
 if(displaySig!==lastDisplays){
  const options=data.displays.map((display,index)=>{const option=el('option','',`${index+1} · ${display.name}`);option.value=display.id;option.title=`${display.width} × ${display.height} · 缩放 ${Math.round(display.scale*100)}%`;return option;});
  if(!options.length){const option=el('option','','未检测到显示器');option.value='';options.push(option);}
  $('displays').replaceChildren(...options);lastDisplays=displaySig;
 }
 $('displays').value=data.selected_monitor;
 const moduleSig=JSON.stringify([data.modules,data.selected_monitor,monitor?.name,playing?.module_id,data.service]);
 if(moduleSig!==lastModules){reconcile($('modules'),data.modules,m=>m.id,m=>JSON.stringify([m,data.service,data.selected_monitor,monitor?.name,playing?.module_id]),module=>{
  const used=playing?.module_id===module.id,card=el('article','module'+(used?' active':'')),art=el('div','module-art');
  const cover=el('button','cover-button apply-cover');cover.dataset.available=String(!!monitor&&!used);cover.setAttribute('aria-label',`将${module.name}应用到${monitor?.name||'当前屏幕'}`);cover.onclick=()=>applyWallpaper(module.id);image(cover,module.cover?data.service+module.cover:null,module.name);art.append(cover);
  if(used)art.append(el('span','used','✓ 使用中'));
  const preview=el('button','wallpaper-preview','▶ 预览');preview.setAttribute('aria-label','预览'+module.name);preview.onclick=()=>previewWallpaper(module.id);art.append(preview);card.append(art);
  const copy=el('div','module-copy'),main=el('div','module-main'),text=el('div','module-text');text.append(el('h3','',module.name));const description=el('p','',module.description);description.title=module.description;text.append(description);main.append(text);
  if(!used){const apply=el('button','apply','应用壁纸');apply.dataset.available=String(!!monitor);apply.title='应用到 '+(monitor?.name||'当前屏幕');apply.onclick=()=>applyWallpaper(module.id);main.append(apply);}
  copy.append(main);taskSlot(copy,module.id);copy.append(moduleDetails(module));card.append(copy);return card;
 });$('empty').hidden=data.modules.length>0;lastModules=moduleSig;}
 const warnings=data.warnings||[];$('warnings-box').hidden=!warnings.length;$('warnings').replaceChildren(...warnings.map(message=>el('li','',message)));
 const online=data.online||{},catalog=online.catalog,items=catalog?.wallpapers||[];
 const updates=items.filter(item=>{const local=data.modules.find(m=>m.id===item.id);return local&&compare(item.version,local.version)>0;}).length;
 $('update-count').textContent=updates?`${updates} 可更新`:items.length?String(items.length):'';
 const onlineError=remoteError||online.last_error||online.lastError||'';$('online-error').hidden=!onlineError;$('online-error').textContent=onlineError;
 const checked=online.checked_at??online.checkedAt??0;
 $('online-status').textContent=checked?`${items.length} 张壁纸 · 按需下载${online.cached?' · 缓存清单':''}`:'来自官方壁纸库，下载后可离线播放。';$('online-status').title=checked?'上次检查 '+new Date(checked*1000).toLocaleString('zh-CN'):'刷新只获取清单，不会自动下载壁纸';
 const taskItems=new Map(downloadTasks().map(t=>[t.id,t.item]));
 const listed=new Map(items.map(item=>[item.id,item]));taskItems.forEach((item,id)=>listed.set(id,item));
 const visibleItems=[...listed.values()].filter(item=>!taskFilter||taskItems.has(item.id));
 reconcile($('online-modules'),visibleItems,item=>item.id,item=>JSON.stringify([item,data.modules.find(m=>m.id===item.id),data.version,data.service,data.selected_monitor,playing?.module_id]),item=>{
  const local=data.modules.find(m=>m.id===item.id),compatible=compare(data.version,item.minAppVersion||item.min_app_version||'0.2.0')>=0;
  const newer=local&&compare(item.version,local.version)>0,current=local?.source==='online'&&compare(item.version,local.version)===0;
  const card=el('article','module');card.title=item.description;image(card,local?.cover?data.service+local.cover:item.coverUrl||item.cover_url,item.name);
  const copy=el('div','module-copy'),heading=el('div','module-heading');heading.append(el('h3','',item.name));if(newer)heading.append(el('span','used update-label','可更新'));else if(local)heading.append(el('span','used',local.source==='builtin'?'已内置':'已下载'));copy.append(heading);
  copy.append(el('p','',item.description),el('div','module-meta',`v${item.version} · ${bytes(item.size)}${local?' · 本机 v'+local.version:''}`));
  const used=current&&playing?.module_id===item.id;
  const text=!compatible?'需要程序 '+(item.minAppVersion||item.min_app_version):used?'正在使用':current?'应用壁纸':newer?'更新到 v'+item.version:local?.source==='builtin'?'下载独立副本':'下载壁纸';
  const download=el('button','apply download',text);download.dataset.available=String(compatible&&(!current||!!monitor&&!used));download.dataset.actionApply=String(current);download.dataset.moduleId=item.id;download.onclick=()=>current?applyWallpaper(item.id):changeDownload(item.id);copy.append(download);taskSlot(copy,item.id);card.append(copy);return card;
 });
 $('online-empty').hidden=visibleItems.length>0;$('online-empty').textContent=taskFilter?'当前任务已完成，可以显示全部壁纸。':'暂时没有可浏览的壁纸，请刷新壁纸库。';
 renderDownloads();
 renderBusy();
}
async function update(){
 if(document.hidden)return;
 if(polling){refreshRequested=true;return;}
 polling=true;
 const epoch=renderEpoch;
 try{const data=await invoke('get_state');if(epoch===renderEpoch)render(data);}
 catch(error){if(epoch===renderEpoch){localError=String(error);$('error').hidden=false;$('error').textContent=localError;}}
 finally{polling=false;if(refreshRequested){refreshRequested=false;queueMicrotask(update);}}
}
function tab(name){if(name==='local')taskFilter=false;activeTab=name;$('collection-title').textContent=name==='local'?'我的壁纸':'发现壁纸';$('collection-description').textContent=name==='local'?'喜欢的风景，随时在身边。':'给桌面，添一点新鲜感。';$('import-open').hidden=name!=='local';$('module-count').hidden=name!=='local';for(const value of ['local','online']){$(value+'-panel').hidden=value!==name;$('tab-'+value).classList.toggle('selected',value===name);$('tab-'+value).setAttribute('aria-pressed',String(value===name));}if(state)render(state);if(name==='online'&&!taskFilter&&!state?.online?.catalog&&!remoteBusy)run('check_online',{},'',true);}
$('download-filter').onclick=()=>{taskFilter=!taskFilter;tab('online');};
$('clear-download-filter').onclick=()=>{taskFilter=false;if(state)render(state);};
$('tab-local').onclick=()=>tab('local');$('tab-online').onclick=()=>tab('online');
$('check-online').onclick=()=>run('check_online',{},'在线清单已更新',true);
$('refresh').onclick=()=>run('refresh_modules',{},'本地壁纸列表已更新');
$('open-folder').onclick=()=>invoke('open_wallpaper_folder').catch(error=>toast(String(error)));
$('import-open').onclick=()=>showDialog('import-dialog');
for(const [id,kind] of [['import-folder','folder'],['import-zip','zip']])$(id).onclick=()=>{$('import-dialog').close();run('import_wallpaper',{kind},'壁纸已导入');};
$('displays').onchange=()=>run('select_monitor',{monitorId:$('displays').value});
$('pause').onclick=()=>{const selected=current();if(selected)run('pause_wallpaper',{monitorId:state.selected_monitor,paused:!selected.paused});};
$('remove').onclick=()=>{closePlaybackMenu();run('remove_wallpaper',{monitorId:state.selected_monitor},'已恢复该屏幕的原桌面');};
$('feed-aquarium').onclick=()=>run('feed_aquarium',{monitorId:state.selected_monitor},'已投喂，回到桌面看看鱼儿吧。');
$('auto-pause').onchange=()=>run('auto_pause',{enabled:$('auto-pause').checked});
$('preview').onclick=()=>{closePlaybackMenu();direct('capture_desktop',{monitorId:state.selected_monitor},'桌面预览已保存');};
$('reload').onclick=()=>{closePlaybackMenu();const playing=current();if(playing)run('apply_wallpaper',{monitorId:state.selected_monitor,moduleId:playing.module_id},'壁纸已重新加载');};
$('show-desktop').onclick=()=>{closePlaybackMenu();direct('show_desktop',{monitorId:state.selected_monitor});};
$('hide').onclick=()=>{closePlaybackMenu();direct('hide_manager');};$('quit').onclick=()=>direct('quit_app');
$('settings-open').onclick=()=>showDialog('settings-dialog');
$('app-update-toggle').onclick=openAppUpdate;
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{
 if(event.target!==dialog)return;
 const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();
}));
document.addEventListener('click',event=>{if(!event.target.closest('#playback-menu'))closePlaybackMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('playback-menu').open){closePlaybackMenu();$('playback-menu').querySelector('summary').focus();}});
$('check-app-update').onclick=()=>runAppUpdate('check_app_update');
$('download-app-update').onclick=()=>runAppUpdate('download_app_update');
$('install-app-update').onclick=()=>{if(appUpdateBusy||appUpdate().phase!=='ready')return;confirmAppVersion=appUpdate().version;$('app-update-confirm-copy').textContent=`将退出当前程序并启动 v${confirmAppVersion} 的安装程序。确认现在升级吗？`;$('app-update-confirm').showModal();};
$('cancel-app-update').onclick=()=>$('app-update-confirm').close();
$('confirm-app-update').onclick=()=>{
 if(appUpdateBusy||appUpdate().phase!=='ready')return;
 $('app-update-confirm').close();
 if(confirmAppVersion!==appUpdate().version){appUpdateError='更新版本已变化，请重新确认。';renderAppUpdate();return;}
 runAppUpdate('install_app_update',{confirmed:true,version:confirmAppVersion});
};
setInterval(update,1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});window.addEventListener('focus',update);update();
})();

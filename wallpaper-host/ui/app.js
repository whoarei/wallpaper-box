(() => {
'use strict';
const invoke=window.__TAURI__.core.invoke,$=id=>document.getElementById(id);
let state=null,localBusy=false,remoteBusy=false,activeTab='local',lastDisplays='',lastModules='',lastOnline='',toastTimer,localError='',remoteError='';
let appUpdateBusy=false,appUpdateError='',lastAppPhase='',confirmAppVersion=null;
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
function current(){return state?.wallpapers.find(w=>w.display_id===state.selected_monitor);}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);}
function compare(a,b){
 const parse=value=>{const v=String(value||'0.0.0').split('+')[0],dash=v.indexOf('-');return {core:(dash<0?v:v.slice(0,dash)).split('.').map(BigInt),pre:dash<0?[]:v.slice(dash+1).split('.')};};
 const x=parse(a),y=parse(b);for(let i=0;i<3;i++){if(x.core[i]!==y.core[i])return x.core[i]>y.core[i]?1:-1;}
 if(!x.pre.length||!y.pre.length)return x.pre.length===y.pre.length?0:x.pre.length?-1:1;
 for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){
  const l=x.pre[i],r=y.pre[i];if(l===r)continue;if(l===undefined)return -1;if(r===undefined)return 1;
  const ln=/^\d+$/.test(l),rn=/^\d+$/.test(r);if(ln&&rn)return BigInt(l)>BigInt(r)?1:-1;if(ln!==rn)return ln?-1:1;return l>r?1:-1;
 }return 0;
}
function bytes(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(n/1024))+' KB';}
function image(card,url,name){if(!url){card.append(el('div','cover-fallback',name));return;}const img=el('img','cover');img.src=url;img.alt=name+'封面';img.referrerPolicy='no-referrer';img.onerror=()=>img.replaceWith(el('div','cover-fallback',name));card.append(img);}
function appUpdate(){return state?.app_update||{phase:'idle',current_version:state?.version,version:null};}
function openAppUpdate(open){$('app-update-panel').hidden=!open;$('app-update-toggle').setAttribute('aria-expanded',String(open));}
function renderAppUpdate(){
 const update=appUpdate(),phase=update.phase||'idle',ready=phase==='ready',working=['checking','downloading','installing'].includes(phase);
 $('app-update-current').textContent=update.current_version||state?.version||'';
 $('app-update-latest-wrap').hidden=!update.version;$('app-update-latest').textContent=update.version||'';
 $('app-update-toggle').textContent=ready?'程序更新 · 已就绪':phase==='downloading'?'程序更新 · 下载中':'程序更新';
 $('app-update-toggle').classList.toggle('update-ready',ready);
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
 if(ready&&lastAppPhase!=='ready'){openAppUpdate(true);toast('程序新版已就绪，可在方便时重启升级。');}
 lastAppPhase=phase;
}
async function runAppUpdate(command,args={}){
 if(appUpdateBusy)return;
 appUpdateBusy=true;appUpdateError='';renderAppUpdate();
 try{const result=await invoke(command,args);if(result)render(result);}
 catch(error){appUpdateError=String(error);openAppUpdate(true);}
 finally{appUpdateBusy=false;renderAppUpdate();}
}
async function run(command,args={},message='',remote=false){
 if(remote?remoteBusy:localBusy)return;
 if(remote){remoteBusy=true;remoteError='';}else{localBusy=true;localError='';}
 renderBusy();
 try{const result=await invoke(command,args);if(result){render(result);if(message)toast(message);}return result;}
 catch(error){if(remote){remoteError=String(error);}else{localError=String(error);}toast(String(error));}
 finally{if(remote)remoteBusy=false;else localBusy=false;lastModules='';lastOnline='';if(state)render(state);renderBusy();}
}
function renderBusy(){
 $('feed-aquarium').disabled=localBusy||!current()||current().paused;
 $('check-online').disabled=remoteBusy||!!state?.transfer;$('check-online').textContent=remoteBusy&&!state?.transfer?'检查中…':'检查更新';
 for(const id of ['import-folder','import-zip'])$(id).disabled=localBusy||!!state?.transfer;
 document.querySelectorAll('.apply').forEach(button=>button.disabled=localBusy||button.dataset.available==='false');
 document.querySelectorAll('.download').forEach(button=>button.disabled=remoteBusy||!!state?.transfer||button.dataset.available==='false');
}
function render(data){
 state=data;$('version').textContent=data.version;renderAppUpdate();
 const monitor=data.displays.find(d=>d.id===data.selected_monitor),playing=current();
 const visibleError=localError||data.last_error||(activeTab==='local'?remoteError:'');$('error').hidden=!visibleError;$('error').textContent=visibleError;
 $('auto-pause').checked=data.auto_pause;
 $('current-title').textContent=playing?playing.name:'该屏幕尚未设置动态壁纸';
 $('current-status').textContent=playing?(playing.paused?'已暂停':playing.auto_paused?'遮挡，自动暂停':'正在播放'):'';
 $('status-dot').classList.toggle('playing',!!playing&&!playing.paused&&!playing.auto_paused);
 $('pause').disabled=!playing;$('pause').textContent=playing?.paused?'继续':'暂停';$('remove').disabled=!playing;
 $('feed-aquarium').hidden=playing?.module_id!=='aquarium';
 $('target-label').textContent=monitor?'应用到 '+monitor.name:'';$('module-count').textContent=String(data.modules.length).padStart(2,'0');
 const displaySig=JSON.stringify([data.displays,data.selected_monitor]);
 if(displaySig!==lastDisplays){$('displays').replaceChildren(...data.displays.map(display=>{const button=el('button','display'+(display.id===data.selected_monitor?' selected':''));button.setAttribute('aria-pressed',String(display.id===data.selected_monitor));button.setAttribute('aria-label','选择 '+display.name);const copy=el('span');copy.append(el('strong','',display.name),el('small','',`${display.width} × ${display.height} · 缩放 ${Math.round(display.scale*100)}%`));button.append(el('span','monitor-icon'),copy);if(display.id===data.selected_monitor)button.append(el('span','check','✓'));button.onclick=()=>run('select_monitor',{monitorId:display.id});return button;}));lastDisplays=displaySig;}
 const moduleSig=JSON.stringify([data.modules,data.selected_monitor,playing?.module_id]);
 if(moduleSig!==lastModules){$('modules').replaceChildren(...data.modules.map(module=>{
  const used=playing?.module_id===module.id,card=el('article','module'+(used?' active':''));image(card,module.cover?data.service+module.cover:null,module.name);
  const copy=el('div','module-copy'),heading=el('div','module-heading');heading.append(el('h3','',module.name));if(used)heading.append(el('span','used','正在使用'));copy.append(heading);
  copy.append(el('div','subtitle',module.subtitle||''),el('p','',module.description),el('div','module-meta',`${({builtin:'内置',online:'已下载',local:'本地'})[module.source]||'本地'} · v${module.version}`));
  const apply=el('button','apply',used?'重新加载壁纸':'设为该屏幕壁纸');apply.dataset.available=String(!!monitor);apply.onclick=()=>run('apply_wallpaper',{monitorId:data.selected_monitor,moduleId:module.id},module.name+' 已应用');copy.append(apply);
  if(module.rollback_available){const rollback=el('button','rollback text-button','切换到上一版本');rollback.onclick=()=>run('rollback_wallpaper',{moduleId:module.id},'已切换版本',true);copy.append(rollback);}
  card.append(copy);return card;
 }));$('empty').hidden=data.modules.length>0;lastModules=moduleSig;}
 const warnings=data.warnings||[];$('warnings-box').hidden=!warnings.length;$('warnings').replaceChildren(...warnings.map(message=>el('li','',message)));
 const online=data.online||{},catalog=online.catalog,items=catalog?.wallpapers||[];
 const updates=items.filter(item=>{const local=data.modules.find(m=>m.id===item.id);return local&&compare(item.version,local.version)>0;}).length;
 $('update-count').textContent=updates?`${updates} 可更新`:items.length?String(items.length):'';
 const onlineError=remoteError||online.last_error||online.lastError||'';$('online-error').hidden=!onlineError;$('online-error').textContent=onlineError;
 const checked=online.checked_at??online.checkedAt??0;
 $('online-status').textContent=checked?`${online.cached?'使用缓存清单 · ':''}上次检查 ${new Date(checked*1000).toLocaleString('zh-CN')} · ${items.length} 张壁纸，仅按需下载`:'检查清单即可浏览，不会自动下载壁纸包。';
 const onlineSig=JSON.stringify([items,data.modules.map(m=>[m.id,m.version,m.source]),data.version,data.transfer?.id]);
 if(onlineSig!==lastOnline){$('online-modules').replaceChildren(...items.map(item=>{
  const local=data.modules.find(m=>m.id===item.id),compatible=compare(data.version,item.minAppVersion||item.min_app_version||'0.2.0')>=0;
  const newer=local&&compare(item.version,local.version)>0,current=local?.source==='online'&&compare(item.version,local.version)===0;
  const downloading=data.transfer?.id===item.id,card=el('article','module');
  image(card,local?.cover?data.service+local.cover:item.coverUrl||item.cover_url,item.name);
  const copy=el('div','module-copy'),heading=el('div','module-heading');heading.append(el('h3','',item.name));if(newer)heading.append(el('span','used update-label','可更新'));else if(local)heading.append(el('span','used',local.source==='builtin'?'已内置':'已下载'));copy.append(heading);
  copy.append(el('div','subtitle',item.subtitle||''),el('p','',item.description),el('div','module-meta',`v${item.version} · ${bytes(item.size)}${local?' · 本机 v'+local.version:''}`));
  let text=downloading?'下载中…':!compatible?'需要程序 '+(item.minAppVersion||item.min_app_version):current?'已是最新':newer?'更新到 v'+item.version:local?.source==='builtin'?'下载独立副本':'下载壁纸';
  const download=el('button','apply download',text);download.dataset.available=String(compatible&&!current&&!downloading);download.onclick=()=>run('install_online',{moduleId:item.id},item.name+' 已安装到本机',true);copy.append(download);card.append(copy);return card;
 }));lastOnline=onlineSig;}
 $('online-empty').hidden=items.length>0;
 const transfer=data.transfer;$('transfer').hidden=!transfer;
 if(transfer){$('transfer-label').textContent='正在下载 '+transfer.name;$('transfer-progress').value=transfer.total?transfer.received/transfer.total*100:0;$('transfer-size').textContent=bytes(transfer.received)+' / '+bytes(transfer.total);}
 renderBusy();
}
async function update(){if(document.hidden)return;try{render(await invoke('get_state'));}catch(error){localError=String(error);$('error').hidden=false;$('error').textContent=localError;}}
function tab(name){activeTab=name;for(const value of ['local','online']){$(value+'-panel').hidden=value!==name;$('tab-'+value).classList.toggle('selected',value===name);$('tab-'+value).setAttribute('aria-pressed',String(value===name));}if(state)render(state);if(name==='online'&&!state?.online?.catalog&&!remoteBusy)run('check_online',{},'',true);}
$('tab-local').onclick=()=>tab('local');$('tab-online').onclick=()=>tab('online');
$('check-online').onclick=()=>run('check_online',{},'在线清单已更新',true);
$('refresh').onclick=()=>run('refresh_modules',{},'本地壁纸列表已更新');
$('open-folder').onclick=()=>invoke('open_wallpaper_folder').catch(error=>toast(String(error)));
$('import-folder').onclick=()=>run('import_wallpaper',{kind:'folder'},'壁纸已导入');$('import-zip').onclick=()=>run('import_wallpaper',{kind:'zip'},'壁纸已导入');
$('pause').onclick=()=>{const selected=current();if(selected)run('pause_wallpaper',{monitorId:state.selected_monitor,paused:!selected.paused});};
$('remove').onclick=()=>run('remove_wallpaper',{monitorId:state.selected_monitor},'已恢复该屏幕的原桌面');
$('feed-aquarium').onclick=()=>run('feed_aquarium',{monitorId:state.selected_monitor},'已投喂，回到桌面看看鱼儿吧。');
$('auto-pause').onchange=()=>run('auto_pause',{enabled:$('auto-pause').checked});
$('preview').onclick=()=>invoke('capture_desktop',{monitorId:state.selected_monitor}).then(()=>toast('桌面预览已保存')).catch(error=>toast(String(error)));
$('show-desktop').onclick=()=>invoke('show_desktop',{monitorId:state.selected_monitor}).catch(error=>toast(String(error)));
$('hide').onclick=()=>invoke('hide_manager');$('quit').onclick=()=>invoke('quit_app');
$('app-update-toggle').onclick=()=>openAppUpdate($('app-update-panel').hidden);
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

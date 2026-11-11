(() => {
'use strict';
const invoke=window.__TAURI__.core.invoke,$=id=>document.getElementById(id);
let state=null,localBusy=false,remoteBusy=false,activeTab='local',lastDisplays='',lastModules='',lastOnline='',toastTimer,localError='',remoteError='';
let proxyBusy=false,proxyDirty=false,lastProxy='',proxyStatus='',proxyError='';
const onlineCovers=new Map();
const defaultRepositories=[{url:'https://gitee.com/xishuaiya/wallpapers',enabled:true},{url:'https://github.com/whoarei/wallpapers',enabled:false}];
let repositoryDrafts=[],repositoriesDirty=false,repositoriesBusy=false,lastRepositories='',repositoriesStatus='',repositoriesError='';
function repositories(){return state?.wallpaper_repositories||defaultRepositories;}
function enabledRepositories(){return repositories().filter(repository=>repository.enabled);}
function repositoryLabel(url){return String(url||'').replace(/^https:\/\//,'').replace(/\.git\/?$/,'');}

let appUpdateBusy=false,appUpdateError='',lastAppPhase='',confirmAppVersion=null,previewBusy=false,renderEpoch=0,lastCurrentArt='',polling=false;
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
function bytes(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(n/1024))+' KB';}
function image(card,url,name){if(!url){card.append(el('div','cover-fallback',name));return;}const img=el('img','cover');img.src=url;img.alt=name+'封面';img.referrerPolicy='no-referrer';img.onerror=()=>img.replaceWith(el('div','cover-fallback',name));card.append(img);}
function onlineImage(card,item,data){
 if(!item.coverUrl&&!item.cover_url){image(card,null,item.name);return;}
 const img=el('img','cover');img.alt=item.name+'封面';card.append(img);
 const key=JSON.stringify([item.coverUrl||item.cover_url,item.repository,data.proxy]);
 let pending=onlineCovers.get(key);
 if(!pending){
  pending=invoke('load_online_cover',{moduleId:item.id});onlineCovers.set(key,pending);
  if(onlineCovers.size>64)onlineCovers.delete(onlineCovers.keys().next().value);
  pending.catch(()=>{if(onlineCovers.get(key)===pending)onlineCovers.delete(key);});
 }
 img.onerror=()=>img.replaceWith(el('div','cover-fallback',item.name));
 pending.then(url=>{if(img.isConnected)img.src=url;}).catch(()=>img.replaceWith(el('div','cover-fallback',item.name)));
}
function renderRepositoryRows(){
 $('repositories-list').replaceChildren(...repositoryDrafts.map((repository,index)=>{
  const row=el('div','repository-row'),id='repository-url-'+index,label=el('label','',`仓库 ${index+1}`);label.htmlFor=id;
  const input=el('input','repository-url');input.id=id;input.type='url';input.value=repository.url;input.placeholder='https://gitee.com/所有者/仓库名.git';input.spellcheck=false;input.autocomplete='off';input.oninput=()=>{repository.url=input.value;editRepositories();};
  const controls=el('div','repository-controls'),toggle=el('label','switch-label'),check=el('input');check.type='checkbox';check.checked=repository.enabled;check.setAttribute('role','switch');check.setAttribute('aria-label',`启用仓库 ${index+1}`);check.onchange=()=>{repository.enabled=check.checked;editRepositories();};toggle.append(el('span','','启用'),check);
  const up=el('button','text-button','上移');up.setAttribute('aria-label',`上移仓库 ${index+1}`);up.dataset.first=String(index===0);up.onclick=()=>{[repositoryDrafts[index-1],repositoryDrafts[index]]=[repositoryDrafts[index],repositoryDrafts[index-1]];renderRepositoryRows();editRepositories();};
  const remove=el('button','text-button danger','移除');remove.setAttribute('aria-label',`移除仓库 ${index+1}`);remove.onclick=()=>{repositoryDrafts.splice(index,1);renderRepositoryRows();editRepositories();};
  controls.append(toggle,up,remove);row.append(label,input,controls,el('p','repository-source-status'));return row;
 }));
}
function renderRepositories(){
 const saved=repositories(),signature=JSON.stringify(saved);
 if(!repositoriesDirty&&signature!==lastRepositories){repositoryDrafts=saved.map(repository=>({...repository}));lastRepositories=signature;renderRepositoryRows();}
 const busy=repositoriesBusy||!state;
 $('repositories-list').querySelectorAll('input,button').forEach(node=>node.disabled=busy||node.dataset.first==='true');
 $('add-repository').disabled=busy||repositoryDrafts.length>=16;
 $('save-repositories').disabled=busy||!repositoriesDirty;
 $('repositories-status').hidden=!repositoriesStatus;$('repositories-status').textContent=repositoriesStatus;
 $('repositories-error').hidden=!repositoriesError;$('repositories-error').textContent=repositoriesError;
 [...$('repositories-list').children].forEach((row,index)=>{
  const draft=repositoryDrafts[index],source=state?.online?.sources?.find(source=>source.repository===draft.url),node=row.querySelector('.repository-source-status');
  node.textContent=!draft.enabled?'已关闭':source?.last_error?source.last_error:source?.catalog?`${source.cached?'使用缓存 · ':''}${source.catalog.wallpapers.length} 张壁纸`:'保存后可在“发现”刷新壁纸库。';
  node.classList.toggle('failed',!!draft.enabled&&!!source?.last_error);
 });
}
function editRepositories(){repositoriesDirty=true;repositoriesStatus='';repositoriesError='';renderRepositories();}
async function saveRepositories(){
 if(repositoriesBusy||!state)return;
 if(repositoryDrafts.some(repository=>!repository.url.trim())){repositoriesError='请填写仓库地址，或移除空白的仓库。';renderRepositories();return;}
 repositoriesBusy=true;repositoriesError='';repositoriesStatus='正在保存…';renderRepositories();
 try{
  const result=await invoke('set_wallpaper_repositories',{repositories:repositoryDrafts.map(repository=>({url:repository.url.trim(),enabled:repository.enabled}))});
  repositoriesDirty=false;lastRepositories='';remoteError='';onlineCovers.clear();lastOnline='';renderEpoch++;render(result);
  repositoriesStatus='已保存。可在“发现”刷新已启用的壁纸仓库。';
 }catch(error){repositoriesStatus='';repositoriesError=String(error);}
 finally{repositoriesBusy=false;renderRepositories();}
}
function proxyDraft(){return {mode:$('proxy-mode').value,url:$('proxy-mode').value==='manual'?$('proxy-url').value.trim():''};}
function renderProxy(){
 const saved=state?.proxy||{mode:'system',url:''},signature=JSON.stringify(saved);
 if(!proxyDirty&&signature!==lastProxy){$('proxy-mode').value=saved.mode;$('proxy-url').value=saved.url||'';lastProxy=signature;}
 const mode=$('proxy-mode').value;
 $('proxy-manual').hidden=mode!=='manual';
 $('proxy-description').textContent=mode==='system'?'优先使用代理环境变量，未设置时读取 Windows 系统代理；不支持 PAC 自动配置脚本。':mode==='direct'?'直接连接网络，忽略系统代理和代理环境变量。':'所有在线请求均使用此代理；SOCKS5H 由代理解析域名。';
 for(const id of ['proxy-mode','proxy-url','test-proxy','save-proxy'])$(id).disabled=proxyBusy||!state;
 $('save-proxy').disabled=proxyBusy||!state||!proxyDirty;
 $('proxy-status').hidden=!proxyStatus;$('proxy-status').textContent=proxyStatus;
 $('proxy-error').hidden=!proxyError;$('proxy-error').textContent=proxyError;
}
function editProxy(){proxyDirty=true;proxyStatus='';proxyError='';renderProxy();}
async function runProxy(save){
 if(proxyBusy||!state)return;
 const proxy=proxyDraft();
 if(proxy.mode==='manual'&&!proxy.url){proxyError='请输入完整的代理地址，例如 http://127.0.0.1:7890。';renderProxy();$('proxy-url').focus();return;}
 proxyBusy=true;proxyError='';proxyStatus=save?'正在保存…':'正在使用当前填写的配置连接 GitHub…';renderProxy();
 try{
  const result=await invoke(save?'set_proxy':'test_proxy',{proxy});
  if(save){proxyDirty=false;lastProxy='';renderEpoch++;render(result);proxyStatus='已保存，从下一次网络请求生效。';}
  else proxyStatus='已成功连接 GitHub。'+(proxyDirty?'当前配置尚未保存。':'');
 }catch(error){proxyStatus='';proxyError=String(error);}
 finally{proxyBusy=false;renderProxy();}
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
 if(module.rollback_available){const rollback=el('button','rollback text-button','切换到上一版本');rollback.onclick=()=>run('rollback_wallpaper',{moduleId:module.id},'已切换版本',true);details.append(rollback);}
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
 finally{renderEpoch++;if(remote)remoteBusy=false;else localBusy=false;lastModules='';lastOnline='';if(state)render(state);renderBusy();}
}
function renderBusy(){
 const playing=current(),hasMonitor=!!state?.displays.some(d=>d.id===state.selected_monitor);
 $('feed-aquarium').disabled=localBusy||!playing||playing.paused;
 for(const id of ['pause','remove','preview','reload'])$(id).disabled=localBusy||!playing;
 $('show-desktop').disabled=localBusy||!hasMonitor;
 $('displays').disabled=localBusy||!state?.displays.length;
 $('auto-pause').disabled=localBusy||!state;
 $('refresh').disabled=localBusy;
 $('check-online').disabled=remoteBusy||!!state?.transfer||!enabledRepositories().length;
 $('check-online').textContent=remoteBusy&&!state?.transfer?'正在刷新…':'刷新壁纸库';
 for(const id of ['import-open','import-folder','import-zip'])$(id).disabled=localBusy||!!state?.transfer;
 document.querySelectorAll('.apply,.apply-cover').forEach(button=>button.disabled=localBusy||button.dataset.available==='false');
 document.querySelectorAll('.download,.rollback').forEach(button=>button.disabled=remoteBusy||!!state?.transfer||button.dataset.available==='false');
 document.querySelectorAll('.wallpaper-preview').forEach(button=>button.disabled=previewBusy);
}
function render(data){
 state=data;$('version').textContent=data.version;renderAppUpdate();renderProxy();renderRepositories();
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
 if(moduleSig!==lastModules){$('modules').replaceChildren(...data.modules.map(module=>{
  const used=playing?.module_id===module.id,card=el('article','module'+(used?' active':'')),art=el('div','module-art');
  const cover=el('button','cover-button apply-cover');cover.dataset.available=String(!!monitor&&!used);cover.setAttribute('aria-label',`将${module.name}应用到${monitor?.name||'当前屏幕'}`);cover.onclick=()=>applyWallpaper(module.id);image(cover,module.cover?data.service+module.cover:null,module.name);art.append(cover);
  if(used)art.append(el('span','used','✓ 使用中'));
  const preview=el('button','wallpaper-preview','▶ 预览');preview.setAttribute('aria-label','预览'+module.name);preview.onclick=()=>previewWallpaper(module.id);art.append(preview);card.append(art);
  const copy=el('div','module-copy'),main=el('div','module-main'),text=el('div','module-text');text.append(el('h3','',module.name));const description=el('p','',module.description);description.title=module.description;text.append(description);main.append(text);
  if(!used){const apply=el('button','apply','应用壁纸');apply.dataset.available=String(!!monitor);apply.title='应用到 '+(monitor?.name||'当前屏幕');apply.onclick=()=>applyWallpaper(module.id);main.append(apply);}
  copy.append(main,moduleDetails(module));card.append(copy);return card;
 }));$('empty').hidden=data.modules.length>0;lastModules=moduleSig;}
 const warnings=data.warnings||[];$('warnings-box').hidden=!warnings.length;$('warnings').replaceChildren(...warnings.map(message=>el('li','',message)));
 const online=data.online||{},catalog=online.catalog,items=catalog?.wallpapers||[];
 const updates=items.filter(item=>{const local=data.modules.find(m=>m.id===item.id);return local&&compare(item.version,local.version)>0;}).length;
 $('update-count').textContent=updates?`${updates} 可更新`:items.length?String(items.length):'';
 const onlineError=remoteError||online.last_error||online.lastError||'';$('online-error').hidden=!onlineError;$('online-error').textContent=onlineError;
 const checked=online.checked_at??online.checkedAt??0,enabled=enabledRepositories();
 $('online-status').textContent=!enabled.length?'尚未启用壁纸仓库，可在设置中开启。':checked?`${online.cached?'使用缓存清单 · ':''}上次检查 ${new Date(checked*1000).toLocaleString('zh-CN')} · ${items.length} 张壁纸，仅按需下载`:`已启用 ${enabled.length} 个仓库，刷新即可浏览，仅按需下载壁纸包。`;
 const onlineSig=JSON.stringify([items,data.modules.map(m=>[m.id,m.version,m.source]),data.version,data.transfer?.id,data.proxy]);
 if(onlineSig!==lastOnline){$('online-modules').replaceChildren(...items.map(item=>{
  const local=data.modules.find(m=>m.id===item.id),compatible=compare(data.version,item.minAppVersion||item.min_app_version||'0.2.0')>=0;
  const newer=local&&compare(item.version,local.version)>0,current=local?.source==='online'&&compare(item.version,local.version)===0;
  const downloading=data.transfer?.id===item.id,card=el('article','module');
  if(local?.cover)image(card,data.service+local.cover,item.name);else onlineImage(card,item,data);
  const copy=el('div','module-copy'),heading=el('div','module-heading');heading.append(el('h3','',item.name));if(newer)heading.append(el('span','used update-label','可更新'));else if(local)heading.append(el('span','used',local.source==='builtin'?'已内置':'已下载'));copy.append(heading);
  if(item.repository)copy.append(el('div','module-meta repository-origin','来源：'+repositoryLabel(item.repository)));
  copy.append(el('p','',item.description),el('div','module-meta',`v${item.version} · ${bytes(item.size)}${local?' · 本机 v'+local.version:''}`));
  let text=downloading?'下载中…':!compatible?'需要程序 '+(item.minAppVersion||item.min_app_version):current?'已是最新':newer?'更新到 v'+item.version:local?.source==='builtin'?'下载独立副本':'下载壁纸';
  const download=el('button','apply download',text);download.dataset.available=String(compatible&&!current&&!downloading);download.onclick=()=>run('install_online',{moduleId:item.id},item.name+' 已安装到本机',true);copy.append(download);card.append(copy);return card;
 }));lastOnline=onlineSig;}
 $('online-empty').hidden=items.length>0;$('online-empty').textContent=enabled.length?'暂时没有可浏览的壁纸，请刷新壁纸库。':'请在设置中添加或启用壁纸仓库。';
 const transfer=data.transfer;$('transfer').hidden=!transfer;
 if(transfer){$('transfer-label').textContent='正在下载 '+transfer.name;$('transfer-progress').value=transfer.total?transfer.received/transfer.total*100:0;$('transfer-size').textContent=bytes(transfer.received)+' / '+bytes(transfer.total);}
 renderBusy();
}
async function update(){
 if(document.hidden||polling)return;
 polling=true;
 const epoch=renderEpoch;
 try{const data=await invoke('get_state');if(epoch===renderEpoch)render(data);}
 catch(error){if(epoch===renderEpoch){localError=String(error);$('error').hidden=false;$('error').textContent=localError;}}
 finally{polling=false;}
}
function tab(name){activeTab=name;$('collection-title').textContent=name==='local'?'我的壁纸':'发现壁纸';$('collection-description').textContent=name==='local'?'喜欢的风景，随时在身边。':'给桌面，添一点新鲜感。';$('import-open').hidden=name!=='local';$('module-count').hidden=name!=='local';for(const value of ['local','online']){$(value+'-panel').hidden=value!==name;$('tab-'+value).classList.toggle('selected',value===name);$('tab-'+value).setAttribute('aria-pressed',String(value===name));}if(state)render(state);if(name==='online'&&enabledRepositories().length&&!state?.online?.catalog&&!remoteBusy)run('check_online',{},'',true);}
$('tab-local').onclick=()=>tab('local');$('tab-online').onclick=()=>tab('online');
$('check-online').onclick=()=>run('check_online',{},'',true);
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
$('add-repository').onclick=()=>{repositoryDrafts.push({url:'',enabled:true});renderRepositoryRows();editRepositories();$('repository-url-'+(repositoryDrafts.length-1)).focus();};
$('save-repositories').onclick=saveRepositories;
$('proxy-mode').onchange=editProxy;$('proxy-url').oninput=editProxy;
$('save-proxy').onclick=()=>runProxy(true);$('test-proxy').onclick=()=>runProxy(false);
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

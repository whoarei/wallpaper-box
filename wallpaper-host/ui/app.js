(() => {
'use strict';
const i18n=window.wallpaperI18n,t=i18n.t,errorText=i18n.message;
let languageBusy=false,languageError='';
const invoke=window.__TAURI__.core.invoke,$=id=>document.getElementById(id);
let state=null,localBusy=false,remoteBusy=false,activeTab='local',lastSelectedDisplay='',lastModules='',toastTimer,localError='',remoteError='';
let appUpdateBusy=false,appUpdateError='',lastAppPhase='',previewBusy=false,renderEpoch=0,lastCurrentArt='',polling=false,refreshRequested=false,taskFilter=false;
const pendingTasks=new Set();
let settingsTab='general';
let autoStartBusy=false,autoStartRequested=false,autoStartError='';
let proxyBusy=false,proxyDirty=false,lastProxy='',proxyStatus='',proxyError='';
const onlineCovers=new Map();
const historyPages=new Map(),historyDownloads=new Map();
let historySession=null,historyGeneration=0,historyContext='',historyTutorialShown=false;
const defaultRepositories=[{url:'https://gitee.com/xishuaiya/wallpapers',enabled:true},{url:'https://github.com/whoarei/wallpapers',enabled:false}];
let repositoryDrafts=[],repositoriesDirty=false,repositoriesBusy=false,lastRepositories='',repositoriesStatus='',repositoriesError='';
function repositories(){return state?.wallpaper_repositories||defaultRepositories;}
function enabledRepositories(){return repositories().filter(repository=>repository.enabled);}
function repositoryLabel(url){return String(url||'').replace(/^https:\/\//,'').replace(/\.git\/?$/,'');}

function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
function contentText(item,field='name'){
 if(!item)return '';
 const metadata=item.module_id?state?.modules.find(module=>module.id===item.module_id)||item:item;
 return metadata.locales?.[i18n.locale]?.[field]||metadata[field]||item[field]||'';
}
function current(){return state?.wallpapers.find(w=>w.display_id===state.selected_monitor);}
function wallpaperActionDisabled(action,playing=current()){
 return localBusy||!playing?.instance_id||!state?.displays.some(display=>display.id===playing.display_id)||playing.paused||playing.action_busy||
  (playing.auto_paused&&!action.allowWhenOccluded)||action.enabled!==true;
}
function renderWallpaperActions(){
 const playing=current(),actions=Array.isArray(playing?.actions)?playing.actions:[];
 $('wallpaper-actions').hidden=!actions.length;
 $('wallpaper-actions-error').hidden=!playing?.actions_error;
 $('wallpaper-actions-error').textContent=errorText(playing?.actions_error);
 const primary=$('wallpaper-action');
 function configure(button,action){
  button.dataset.wallpaperAction=action.id;button.textContent=action.label;
  button.disabled=wallpaperActionDisabled(action,playing);
  button.title=(playing?.paused?t('壁纸已暂停，请先继续播放。'):errorText(action.disabledReason))||action.label;
  button.onclick=()=>invokeWallpaperAction(action,playing);
 }
 if(actions[0])configure(primary,actions[0]);
 $('wallpaper-actions-menu').hidden=actions.length<2;
 if(actions.length<2)$('wallpaper-actions-menu').open=false;
 const scope=playing?.instance_id||'';
 if($('wallpaper-actions').dataset.instance!==scope){
  $('wallpaper-actions').dataset.instance=scope;$('wallpaper-actions-menu').open=false;
  $('wallpaper-extra-actions').replaceChildren();
 }
 reconcile($('wallpaper-extra-actions'),actions.slice(1),action=>action.id,action=>action.id,action=>{
  const button=el('button','');button.type='button';configure(button,action);return button;
 });
 for(const button of $('wallpaper-extra-actions').children){
  const action=actions.find(action=>action.id===button.dataset.cardKey);if(action)configure(button,action);
 }
}
async function invokeWallpaperAction(action,playing){
 if(wallpaperActionDisabled(action,playing))return;
 const monitorId=playing.display_id,instanceId=playing.instance_id;
 localBusy=true;localError='';renderEpoch++;$('wallpaper-actions-menu').open=false;renderBusy();
 try{
  const result=await invoke('invoke_wallpaper_action',{monitorId,instanceId,actionId:action.id});
  if(!result?.ok)throw new Error(result?.message||t('未能确认操作结果，请先查看壁纸，避免重复操作。'));
  toast(t('已完成：')+action.label);
 }catch(error){localError=String(error.message||error);toast(localError);}
 finally{localBusy=false;renderEpoch++;if(state)render(state);update();}
}
function toast(message,duration=3500){
 const node=$('toast');node.textContent=errorText(message);
 // Keep feedback visible above a modal settings/import dialog without taking focus.
 if(node.showPopover){if(node.matches(':popover-open'))node.hidePopover();node.showPopover();}
 node.classList.add('show');clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>{node.classList.remove('show');if(node.hidePopover&&node.matches(':popover-open'))node.hidePopover();},duration);
}
window.addEventListener('window-control-error',event=>toast(event.detail));
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
function renderResources(playing){
 const panel=$('current-resources'),usage=playing?.resources;
 panel.hidden=!playing;if(!playing)panel.open=false;
 const fallback=usage?.status==='unavailable'?t('暂不可用'):t('采样中');
 $('resource-cpu').textContent=typeof usage?.cpu_percent==='number'&&Number.isFinite(usage.cpu_percent)?usage.cpu_percent.toFixed(1)+'%':fallback;
 $('resource-memory').textContent=typeof usage?.memory_bytes==='number'&&Number.isFinite(usage.memory_bytes)?(usage.memory_bytes/1048576).toFixed(0)+' MB':fallback;
}
function image(card,url,name){if(!url){card.append(el('div','cover-fallback',name));return;}const img=el('img','cover');img.src=url;img.alt=name+t('封面');img.referrerPolicy='no-referrer';img.onerror=()=>img.replaceWith(el('div','cover-fallback',name));card.append(img);}
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
function renderDisplays(data){
 const list=$('displays');
 const items=data.displays.map((display,index)=>{
  const playing=data.wallpapers.find(w=>w.display_id===display.id),module=data.modules.find(m=>m.id===playing?.module_id);
  return {display,index,playing,art:module?.cover?data.service+module.cover:''};
 });
 reconcile(list,items,item=>item.display.id,item=>JSON.stringify([i18n.locale,item.display,item.index,item.art,item.playing?.module_id]),({display,index,playing,art})=>{
  const button=el('button','monitor-choice');button.type='button';button.dataset.monitorId=display.id;
  const stand=el('span','monitor-stand'),screen=el('span','monitor-screen');stand.setAttribute('aria-hidden','true');
  const factor=Math.min(60/Math.max(1,display.width),33/Math.max(1,display.height));screen.style.width=Math.round(display.width*factor)+'px';screen.style.height=Math.round(display.height*factor)+'px';
  const portrait=display.height>display.width,fallback=()=>el('span','monitor-placeholder',contentText(playing)?.slice(0,portrait?1:2)||(portrait?'—':t('未设置')));
  if(art){const img=el('img','monitor-art');img.src=art;img.alt='';img.onerror=()=>img.replaceWith(fallback());screen.append(img);}else screen.append(fallback());
  screen.append(el('span','monitor-check','✓'));stand.append(screen);button.append(stand,el('span','monitor-caption',`${index+1} · ${display.primary?t('主屏'):t('副屏')}`));
  button.onclick=async()=>{
   if(localBusy||state?.selected_monitor===display.id)return;
   const restoreFocus=document.activeElement===button;
   await run('select_monitor',{monitorId:display.id});
   if(restoreFocus&&document.activeElement===document.body){const target=[...$('displays').children].find(node=>node.dataset.monitorId===display.id);if(target&&!target.disabled)target.focus({preventScroll:true});}
  };return button;
 });
 if(!items.length){const empty=el('span','monitor-empty-note',t('未检测到显示器'));list.append(empty);}
 items.forEach(({display,index,playing})=>{
  const button=[...list.children].find(node=>node.dataset.monitorId===display.id),selected=display.id===data.selected_monitor;
  const status=playing?(playing.paused?t('已暂停'):playing.auto_paused?t('遮挡，自动暂停'):t('正在播放')):t('未设置壁纸');
  button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-label',t('选择显示器 {index}：{name}，{wallpaper}',{index:index+1,name:display.name,wallpaper:contentText(playing)||t('未设置壁纸')}));
  button.title=`${display.name}\n${t('{size} · 缩放 {scale}%',{size:display.width+' × '+display.height,scale:Math.round(display.scale*100)})}\n${playing?contentText(playing)+' · ':''}${status}`;
 });
 if(lastSelectedDisplay!==data.selected_monitor){
  const selected=[...list.children].find(node=>node.dataset.monitorId===data.selected_monitor);
  if(selected){const left=selected.offsetLeft-list.offsetLeft,right=left+selected.offsetWidth;if(left<list.scrollLeft)list.scrollLeft=left;else if(right>list.scrollLeft+list.clientWidth)list.scrollLeft=right-list.clientWidth;}
  lastSelectedDisplay=data.selected_monitor;
 }
}
function taskSlot(card,id){const slot=el('div','download-task');slot.dataset.downloadId=id;slot.hidden=true;card.append(slot);}
function renderDownloads(){
 const tasks=downloadTasks(),count=phase=>tasks.filter(t=>t.phase===phase).length;
 const processing=tasks.filter(t=>['verifying','waiting_install','installing','cancelling'].includes(t.phase)).length;
 const parts=[];if(count('downloading'))parts.push(t('下载中 ')+count('downloading'));if(processing)parts.push(t('处理中 ')+processing);if(count('queued'))parts.push(t('等待 ')+count('queued'));if(count('failed'))parts.push(t('失败 ')+count('failed'));
 $('download-filter').hidden=!tasks.length&&!taskFilter;$('download-filter').textContent=parts.join(' · ')||t('显示全部壁纸');$('download-filter').title=(parts.join(' · ')||t('当前没有任务'))+t('。最多 5 项并行，点击筛选相关壁纸');$('download-filter').setAttribute('aria-pressed',String(taskFilter));$('download-filter').classList.toggle('has-errors',!!count('failed'));
 $('clear-download-filter').hidden=!taskFilter;
 for(const slot of document.querySelectorAll('[data-download-id]')){
  const id=slot.dataset.downloadId,task=downloadTask(id);slot.hidden=!task;
  const card=slot.closest('.module'),normal=card.querySelector('.download');if(normal)normal.hidden=!!task;
  if(!task)continue;
  if(slot.dataset.phase!==task.phase||slot.dataset.locale!==i18n.locale){
   slot.dataset.locale=i18n.locale;
   slot.dataset.phase=task.phase;slot.className='download-task '+task.phase;slot.replaceChildren();
   const meter=el('div','task-meter'),heading=el('div','task-heading'),label=el('span','task-label'),percentage=el('span','task-percentage');heading.append(label,percentage);
   const progress=el('progress','task-progress');progress.max=100;progress.setAttribute('aria-label',contentText(task.item)+t('下载进度'));
   const meta=el('div','task-meta'),size=el('span','task-size'),speed=el('span','task-speed');meta.append(size,speed);meter.append(heading,progress,meta);
   const tools=el('div','task-tools'),action=el('button','task-action'),dismiss=el('button','task-dismiss','×');
   const failed=task.phase==='failed';action.textContent=failed?t('重试'):task.phase==='queued'?t('移出'):t('取消');action.classList.toggle('retry',failed);action.setAttribute('aria-label',(failed?t('重试'):task.phase==='queued'?t('移出队列：'):t('取消下载：'))+contentText(task.item));action.onclick=()=>changeDownload(id,failed?'retry':'cancel');
   action.hidden=!['downloading','queued','failed'].includes(task.phase);dismiss.hidden=!failed;dismiss.title=t('移除失败记录');dismiss.setAttribute('aria-label',t('移除失败记录：')+contentText(task.item));dismiss.onclick=()=>changeDownload(id,'cancel');tools.append(action,dismiss);slot.append(meter,tools);
  }
  const phase=task.phase,p=Math.max(0,Math.min(100,task.total?task.received/task.total*100:0));
  const labels={queued:t('等待中'),downloading:t('正在下载'),cancelling:t('正在取消'),verifying:t('校验中'),waiting_install:t('等待安装'),installing:t('安装中'),failed:t('下载失败')};
  slot.querySelector('.task-label').textContent=(labels[phase]||t('处理中'))+' · v'+task.item.version;slot.querySelector('.task-percentage').textContent=phase==='downloading'?Math.floor(p)+'%':'';
  const progress=slot.querySelector('progress');progress.value=p;progress.hidden=['queued','failed','cancelling'].includes(phase);progress.setAttribute('aria-valuetext',phase==='downloading'?Math.floor(p)+'%':labels[phase]||t('处理中'));
  slot.querySelector('.task-size').textContent=phase==='queued'?t('空出位置后自动开始'):phase==='failed'?errorText(task.error)||t('下载中断，请重试'):phase==='cancelling'?t('正在停止连接，保留已安装壁纸'):phase==='downloading'?bytes(task.received)+' / '+bytes(task.total):phase==='verifying'?t('下载完成，正在校验'):phase==='waiting_install'?t('校验通过，等待保存到本机'):t('正在保存到本机');
  slot.querySelector('.task-size').title=errorText(task.error);slot.querySelector('.task-speed').textContent=phase==='queued'?t('第 ')+task.queue_position+t(' 项'):phase==='downloading'&&task.speed?bytes(task.speed)+'/s':'';
  slot.querySelectorAll('button').forEach(button=>button.disabled=pendingTasks.has(id));
 }
}
async function changeDownload(moduleId,action='enqueue',versionItem=null){
 if(pendingTasks.has(moduleId))return;pendingTasks.add(moduleId);const epoch=++renderEpoch;renderBusy();
 try{
  const args=action==='enqueue'?{moduleId}:{moduleId,action};
  if(versionItem){args.version=versionItem.version;args.repository=versionItem.repository;historyDownloads.set(moduleId,{version:versionItem.version,name:versionItem.name});}
  const result=await invoke(action==='enqueue'?'install_online':'download_action',args);
  if(action==='cancel')historyDownloads.delete(moduleId);
  if(versionItem&&result?.downloads?.some(task=>task.id===moduleId))toast(t('正在下载 v')+versionItem.version+t('，完成后替换当前版本'),3000);
  if(result&&epoch===renderEpoch)render(result);
 }
 catch(error){if(versionItem){historyDownloads.delete(moduleId);historyPages.delete(JSON.stringify([versionItem.repository,moduleId]));}toast(String(error));}
 finally{renderEpoch++;pendingTasks.delete(moduleId);renderBusy();update();}
}
function closeHistory(){
 const menu=$('wallpaper-versions');
 if(menu.matches(':popover-open'))menu.hidePopover();
 historySession?.anchor.setAttribute('aria-expanded','false');historySession=null;
}
function resetHistory(){closeHistory();historyPages.clear();historyGeneration++;}
function positionHistory(){
 const session=historySession,menu=$('wallpaper-versions');if(!session||!menu.matches(':popover-open'))return;
 if(!session.anchor.isConnected||session.anchor.disabled){closeHistory();return;}
 const box=session.anchor.getBoundingClientRect(),size=menu.getBoundingClientRect();
 const bottom=Math.min(innerHeight-12,document.querySelector('.player-wrap').getBoundingClientRect().top-12);
 menu.style.left=Math.max(12,Math.min(box.left-8,innerWidth-size.width-12))+'px';
 menu.style.top=(bottom-box.bottom>=size.height?box.bottom+6:Math.max(12,box.top-size.height-6))+'px';
}
function renderHistory(){
 const session=historySession;if(!session)return;
 const menu=$('wallpaper-versions'),entry=session.entry;
 const focused=document.activeElement?.dataset.version;
 const local=state?.modules.find(module=>module.id===session.item.id),versions=new Map(entry.items);
 if(local?.source==='online'&&!versions.has(local.version))versions.set(local.version,{version:local.version,currentOnly:true});
 menu.replaceChildren();
 for(const item of [...versions.values()].sort((a,b)=>compare(b.version,a.version))){
  const current=local?.source==='online'&&compare(item.version,local.version)===0,compatible=item.currentOnly||compare(state.version,item.minAppVersion||item.min_app_version||'0.2.0')>=0;
  const option=el('button','wallpaper-version-option');option.type='button';option.dataset.version=item.version;option.setAttribute('role','option');option.setAttribute('aria-selected',String(current));
  option.append(el('span','','v'+item.version));
  if(current)option.append(el('span','version-current','✓'));else if(!compatible)option.append(el('small','',t('需 ')+(item.minAppVersion||item.min_app_version)));else if(item.version===session.item.version)option.append(el('small','',t('最新')));
  option.disabled=current||!compatible||!!downloadTask(session.item.id)||pendingTasks.has(session.item.id)||!!item.currentOnly;
  option.title=current?t('本机当前版本'):!compatible?t('需要壁纸盒子 ')+(item.minAppVersion||item.min_app_version):t('下载并替换为 v')+item.version;
  option.onclick=()=>{closeHistory();changeDownload(item.id,'enqueue',item);};menu.append(option);
 }
 const status=(text,action)=>{const node=el(action?'button':'div','wallpaper-version-status',text);if(action){node.type='button';node.onclick=()=>{if(historySession)historySession.keyboard=true;action();};}else node.setAttribute('role','status');menu.append(node);};
 if(entry.loading)status(t('正在加载…'));
 else if(entry.error)status(t('加载未完成，点击重试'),()=>loadHistoryPage(entry,entry.retryPage));
 else if(!entry.loaded)status(t('加载版本'),()=>loadHistoryPage(entry,1));
 if(!entry.loading&&entry.loaded&&entry.nextPage)status(t('更早版本 ↓'),()=>loadHistoryPage(entry,entry.nextPage));
 if(entry.loaded&&!entry.items.size&&!entry.nextPage&&!entry.error)status(t('暂无历史版本'));
 menu.setAttribute('aria-busy',String(entry.loading));positionHistory();
 if(focused)[...menu.querySelectorAll('[data-version]')].find(option=>option.dataset.version===focused&&!option.disabled)?.focus({preventScroll:true});
 else if(session.keyboard&&!entry.loading&&(entry.loaded||entry.error)&&menu.matches(':popover-open')){menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});session.keyboard=false;}
}
async function loadHistoryPage(entry,page){
 if(entry.loading||entry.generation!==historyGeneration)return;entry.loading=true;entry.error='';entry.retryPage=page;renderHistory();
 try{
  const result=await invoke('load_wallpaper_history',{moduleId:entry.id,repository:entry.repository,page});
  if(entry.generation!==historyGeneration)return;
  for(const item of result.wallpapers||[])if(!entry.items.has(item.version))entry.items.set(item.version,item);
  entry.loaded=true;entry.nextPage=result.next_page;entry.error=result.warning||'';
 }catch(error){if(entry.generation===historyGeneration){entry.error=String(error);toast(entry.error,3000);}}
 finally{entry.loading=false;if(entry.generation===historyGeneration)renderHistory();}
}
function openHistory(item,anchor,keyboard=false){
 if(historySession?.anchor===anchor){closeHistory();return;}closeHistory();
 const key=JSON.stringify([item.repository,item.id]);let entry=historyPages.get(key);
 if(!entry){entry={id:item.id,repository:item.repository,generation:historyGeneration,items:new Map(),loaded:false,loading:false,nextPage:null,retryPage:1,error:''};historyPages.set(key,entry);if(historyPages.size>32)historyPages.delete(historyPages.keys().next().value);}
 historySession={item,anchor,entry,keyboard};const menu=$('wallpaper-versions');menu.setAttribute('aria-label',contentText(item)+t('历史版本'));renderHistory();menu.showPopover();anchor.setAttribute('aria-expanded','true');positionHistory();
 if(!historyTutorialShown){historyTutorialShown=true;toast(t('点击版本号即可下载并替换当前版本'),3000);}
 if(!entry.loaded&&!entry.loading)loadHistoryPage(entry,1);
 else if(keyboard&&!entry.loading){menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});historySession.keyboard=false;}
}
$('wallpaper-versions').addEventListener('toggle',event=>{if(event.newState==='closed'){historySession?.anchor.setAttribute('aria-expanded','false');historySession=null;}});
$('wallpaper-versions').addEventListener('keydown',event=>{
 const menu=$('wallpaper-versions'),options=[...menu.querySelectorAll('button:not(:disabled)')],index=options.indexOf(document.activeElement);let next;
 if(event.key==='Escape'){event.preventDefault();const anchor=historySession?.anchor;closeHistory();anchor?.focus();return;}
 if(!options.length)return;
 if(event.key==='ArrowDown')next=(index+1)%options.length;else if(event.key==='ArrowUp')next=(index-1+options.length)%options.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=options.length-1;else return;
 event.preventDefault();options[next].focus();
});
window.addEventListener('resize',positionHistory);window.addEventListener('scroll',positionHistory,true);
function onlineImage(card,item,data){
 if(!item.coverUrl&&!item.cover_url){image(card,null,contentText(item));return;}
 const img=el('img','cover');img.alt=contentText(item)+t('封面');card.append(img);
 const key=JSON.stringify([item.coverUrl||item.cover_url,item.repository,data.proxy]);
 let pending=onlineCovers.get(key);
 if(!pending){
  pending=invoke('load_online_cover',{moduleId:item.id});onlineCovers.set(key,pending);
  if(onlineCovers.size>64)onlineCovers.delete(onlineCovers.keys().next().value);
  pending.catch(()=>{if(onlineCovers.get(key)===pending)onlineCovers.delete(key);});
 }
 img.onerror=()=>img.replaceWith(el('div','cover-fallback',contentText(item)));
 pending.then(url=>{if(img.isConnected)img.src=url;}).catch(()=>img.replaceWith(el('div','cover-fallback',contentText(item))));
}
function repositoryName(address){try{const host=new URL(address).hostname;return host==='gitee.com'?'Gitee':host==='github.com'?'GitHub':t('自定义仓库');}catch{return address?t('自定义仓库'):t('新仓库');}}
function renderRepositoryRows(){
 $('repositories-list').replaceChildren(...repositoryDrafts.map((repository,index)=>{
  const row=el('div','repository-row'),header=el('div','repository-heading'),id='repository-url-'+index,label=el('label','repository-name',repositoryName(repository.url));label.htmlFor=id;
  const input=el('input','repository-url');input.id=id;input.type='url';input.value=repository.url;input.setAttribute('aria-label',t('仓库地址 {index}',{index:index+1}));input.placeholder=t('https://gitee.com/所有者/仓库名.git');input.spellcheck=false;input.autocomplete='off';input.oninput=()=>{repository.url=input.value;label.textContent=repositoryName(input.value);editRepositories();};
  const toggle=el('label','switch-label'),check=el('input');check.type='checkbox';check.checked=repository.enabled;check.setAttribute('role','switch');check.setAttribute('aria-label',t('启用仓库 {index}',{index:index+1}));check.onchange=()=>{repository.enabled=check.checked;editRepositories();};toggle.append(check);header.append(label,toggle);
  const controls=el('div','repository-controls'),status=el('p','repository-source-status');
  const up=el('button','text-button',t('上移'));up.setAttribute('aria-label',t('上移仓库 {index}',{index:index+1}));up.dataset.first=String(index===0);up.onclick=()=>{[repositoryDrafts[index-1],repositoryDrafts[index]]=[repositoryDrafts[index],repositoryDrafts[index-1]];renderRepositoryRows();editRepositories();$('repository-url-'+(index-1)).focus();};
  const remove=el('button','text-button repository-remove',t('移除'));remove.setAttribute('aria-label',t('移除仓库 {index}',{index:index+1}));remove.onclick=()=>{repositoryDrafts.splice(index,1);renderRepositoryRows();editRepositories();if(repositoryDrafts.length)$('repository-url-'+Math.min(index,repositoryDrafts.length-1)).focus();else $('add-repository').focus();};
  controls.append(status,up,remove);row.append(header,input,controls);return row;
 }));
}
function renderRepositories(){
 const saved=repositories(),signature=JSON.stringify(saved);
 if(!repositoriesDirty&&signature!==lastRepositories){repositoryDrafts=saved.map(repository=>({...repository}));lastRepositories=signature;renderRepositoryRows();}
 const busy=repositoriesBusy||!state;
 $('repositories-list').querySelectorAll('input,button').forEach(node=>node.disabled=busy||node.dataset.first==='true');
 $('add-repository').disabled=busy||repositoryDrafts.length>=16;
 $('save-repositories').disabled=busy||!repositoriesDirty;
 $('repositories-status').textContent=t(repositoriesStatus)||(repositoriesDirty?t('更改尚未保存'):t('保存后生效'));$('repositories-status').dataset.feedback=String(!!repositoriesStatus);
 $('repositories-error').hidden=!repositoriesError;$('repositories-error').textContent=errorText(repositoriesError);
 [...$('repositories-list').children].forEach((row,index)=>{
  const draft=repositoryDrafts[index],source=state?.online?.sources?.find(source=>source.repository===draft.url),node=row.querySelector('.repository-source-status');
  node.textContent=!draft.enabled?t('已关闭'):source?.last_error?errorText(source.last_error):source?.catalog?t('{cached}{count} 张壁纸',{cached:source.cached?t('使用缓存 · '):'',count:source.catalog.wallpapers.length}):t('已启用');
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
  repositoriesDirty=false;lastRepositories='';remoteError='';onlineCovers.clear();renderEpoch++;render(result);
  repositoriesStatus='已保存，可在“发现”刷新。';
 }catch(error){repositoriesStatus='';repositoriesError=String(error);}
 finally{repositoriesBusy=false;renderRepositories();}
}
function proxyDraft(){return {mode:$('proxy-mode').value,url:$('proxy-mode').value==='manual'?$('proxy-url').value.trim():''};}
function renderProxy(){
 const saved=state?.proxy||{mode:'system',url:''},signature=JSON.stringify(saved);
 if(!proxyDirty&&signature!==lastProxy){$('proxy-mode').value=saved.mode;$('proxy-url').value=saved.url||'';lastProxy=signature;}
 const mode=$('proxy-mode').value;
 $('proxy-manual').hidden=mode!=='manual';
 $('proxy-description').textContent=mode==='system'?t('使用系统配置的代理连接网络。'):mode==='direct'?t('直接连接网络，不使用代理。'):t('通过指定的代理连接网络。');
 for(const id of ['proxy-mode','proxy-url','test-proxy','save-proxy'])$(id).disabled=proxyBusy||!state;
 $('save-proxy').disabled=proxyBusy||!state||!proxyDirty;
 $('proxy-status').textContent=t(proxyStatus)||(proxyDirty?t('更改尚未保存'):t('保存后生效'));$('proxy-status').dataset.feedback=String(!!proxyStatus);
 $('proxy-error').hidden=!proxyError;$('proxy-error').textContent=errorText(proxyError);
}
function editProxy(){proxyDirty=true;proxyStatus='';proxyError='';renderProxy();}
async function runProxy(save){
 if(proxyBusy||!state)return;
 const proxy=proxyDraft();
 if(proxy.mode==='manual'&&!proxy.url){proxyError='请输入完整的代理地址，例如 http://127.0.0.1:7890。';renderProxy();$('proxy-url').focus();return;}
 proxyBusy=true;proxyError='';proxyStatus=save?'正在保存…':'正在测试连接…';renderProxy();
 try{
  const result=await invoke(save?'set_proxy':'test_proxy',{proxy});
  if(save){proxyDirty=false;lastProxy='';renderEpoch++;render(result);proxyStatus='已保存，下次请求生效。';}
  else proxyStatus='已成功连接 GitHub'+(proxyDirty?' · 尚未保存':'。');
 }catch(error){proxyStatus='';proxyError=String(error);}
 finally{proxyBusy=false;renderProxy();}
}
function appUpdate(){return state?.app_update||{phase:'idle',current_version:state?.version,version:null};}
function showDialog(id){const dialog=$(id);if(!dialog.open)dialog.showModal();}
function openAbout(){closePlaybackMenu();showDialog('about-dialog');}
function selectSettingsTab(name,focus=false){
 const target=document.querySelector(`[data-settings-tab="${name}"]`);if(!target)return;
 settingsTab=name;
 document.querySelectorAll('[data-settings-tab]').forEach(button=>{const selected=button===target;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;$(button.getAttribute('aria-controls')).hidden=!selected;});
 if(focus)target.focus({preventScroll:true});
}
function openSettings(name=settingsTab){selectSettingsTab(name);showDialog('settings-dialog');$('settings-tab-'+name).focus({preventScroll:true});}
function openAppUpdate(){openSettings('updates');}
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
 if(monitor)run('apply_wallpaper',{monitorId:monitor.id,moduleId},t('已应用到 ')+monitor.name);
}
function moduleDetails(module){
 const details=el('details','module-details');details.append(el('summary','',t('详情')));
 details.append(el('div','module-meta',`${({builtin:t('内置'),online:t('已下载'),local:t('本地')})[module.source]||t('本地')} · v${module.version}`),el('p','module-description',contentText(module,'description')));
 if(module.rollback_available){const rollback=el('button','rollback text-button',t('切换到上一版本'));rollback.dataset.moduleId=module.id;rollback.onclick=()=>run('rollback_wallpaper',{moduleId:module.id},t('已切换版本'),true);details.append(rollback);}
 return details;
}
function renderAppUpdate(){
 const update=appUpdate(),phase=update.phase||'idle',ready=phase==='ready',working=['checking','downloading','installing'].includes(phase);
 $('version').textContent=update.current_version||state?.version||'';
 $('about-version').textContent=$('version').textContent||t('正在读取');
 $('app-update-latest-wrap').hidden=!update.version;$('app-update-latest').textContent=update.version||'';
 $('app-update-toggle').hidden=!ready;
 const status={idle:t('自动检查更新已开启。'),checking:t('正在检查程序更新…'),downloading:t('正在后台下载，完成后将验证安装包。'),ready:t('v{version} 已下载并验证，可以重启升级。',{version:update.version||''}),up_to_date:t('已是最新版本。'),installing:t('正在启动安装程序…'),error:t('程序更新暂时未能完成。')};
 let description=status[phase]||status.idle;
 $('app-update-last-checked').hidden=!update.last_checked_at;$('app-update-last-checked').textContent=update.last_checked_at?t('上次检查 ')+new Date(update.last_checked_at*1000).toLocaleString(i18n.locale):'';
 $('app-update-status').textContent=description;
 $('app-update-progress-wrap').hidden=phase!=='downloading';
 const received=Math.max(0,Number(update.received)||0),total=Number(update.total)||0;
 if(total>0)$('app-update-progress').value=Math.min(100,received/total*100);else $('app-update-progress').removeAttribute('value');
 $('app-update-size').textContent=(received?bytes(received):'0 KB')+' / '+(total>0?bytes(total):t('正在获取大小'));
 const error=appUpdateError||update.error||'';$('app-update-error').hidden=!error;$('app-update-error').textContent=errorText(error);
 $('app-update-notes-wrap').hidden=!update.notes;$('app-update-notes').textContent=update.notes||'';
 $('check-app-update').disabled=appUpdateBusy||working;
 $('download-app-update').hidden=phase!=='error'||!update.version;$('download-app-update').disabled=appUpdateBusy||working;
 $('install-app-update').hidden=!ready;$('install-app-update').disabled=appUpdateBusy||!ready;
 if(ready&&lastAppPhase!=='ready')toast(t('新版已就绪，可在设置中重启升级。'));
 lastAppPhase=phase;
}
async function runAppUpdate(command,args={}){
 if(appUpdateBusy)return;
 appUpdateBusy=true;const epoch=++renderEpoch;appUpdateError='';renderAppUpdate();
 try{const result=await invoke(command,args);if(result&&epoch===renderEpoch)render(result);}
 catch(error){appUpdateError=String(error);}
 finally{renderEpoch++;appUpdateBusy=false;renderAppUpdate();}
}
function renderLanguage(){
 $('language').value=state?.language||'system';$('language').disabled=languageBusy||!state;
 $('language-error').hidden=!languageError;$('language-error').textContent=errorText(languageError);
}
async function setLanguage(language){
 if(languageBusy||!state)return;
 languageBusy=true;languageError='';renderLanguage();
 // Invalidate an in-flight poll before applying the saved locale.
 renderEpoch++;
 try{const result=await invoke('set_language',{language});renderEpoch++;render(result);}
 catch(error){languageError=String(error);}
 finally{languageBusy=false;renderLanguage();update();}
}
function renderAutoStart(){
 $('auto-start').checked=autoStartBusy?autoStartRequested:(state?.auto_start??true);
 $('auto-start').disabled=autoStartBusy||!state;
 const error=autoStartError||state?.auto_start_error||'';
 $('auto-start-error').hidden=!error;$('auto-start-error').textContent=errorText(error);
}
async function setAutoStart(enabled){
 if(autoStartBusy||!state)return;
 autoStartRequested=enabled;autoStartBusy=true;autoStartError='';const epoch=++renderEpoch;renderAutoStart();
 try{const result=await invoke('set_auto_start',{enabled});if(result&&epoch===renderEpoch)render(result);}
 catch(error){autoStartError=String(error);}
 finally{renderEpoch++;autoStartBusy=false;renderAutoStart();update();}
}
async function run(command,args={},message='',remote=false){
 if(remote?remoteBusy:localBusy)return;
 if(command==='check_online')resetHistory();
 const epoch=++renderEpoch;
 if(remote){remoteBusy=true;remoteError='';}else{localBusy=true;localError='';}
 renderBusy();
 try{const result=await invoke(command,args);if(result){if(epoch===renderEpoch)render(result);if(message)toast(message);}return result;}
 catch(error){if(remote){remoteError=String(error);}else{localError=String(error);}toast(String(error));}
 finally{renderEpoch++;if(remote)remoteBusy=false;else localBusy=false;lastModules='';if(state)render(state);renderBusy();}
}
function renderBusy(){
 const playing=current(),hasMonitor=!!state?.displays.some(d=>d.id===state.selected_monitor);
 renderWallpaperActions();
 for(const id of ['pause','remove','preview','reload'])$(id).disabled=localBusy||!playing;
 $('show-desktop').disabled=localBusy||!hasMonitor;
 $('displays').setAttribute('aria-busy',String(localBusy));document.querySelectorAll('.monitor-choice').forEach(button=>button.disabled=localBusy);
 $('auto-pause').disabled=localBusy||!state;
 $('refresh').disabled=localBusy;
 $('check-online').disabled=remoteBusy||!enabledRepositories().length;
 $('check-online').textContent=remoteBusy?t('正在刷新…'):t('刷新壁纸库');
 for(const id of ['import-folder','import-zip'])$(id).disabled=localBusy;
 document.querySelectorAll('.apply,.apply-cover').forEach(button=>button.disabled=localBusy||button.dataset.available==='false');
 document.querySelectorAll('.rollback').forEach(button=>{const task=downloadTask(button.dataset.moduleId);button.disabled=remoteBusy||pendingTasks.has(button.dataset.moduleId)||(!!task&&task.phase!=='failed')||button.dataset.available==='false';});
 document.querySelectorAll('.download').forEach(button=>button.disabled=(button.dataset.actionApply==='true'&&localBusy)||pendingTasks.has(button.dataset.moduleId)||button.dataset.available==='false');
 document.querySelectorAll('[data-download-id] button').forEach(button=>button.disabled=pendingTasks.has(button.closest('[data-download-id]').dataset.downloadId));
 document.querySelectorAll('.wallpaper-preview').forEach(button=>button.disabled=previewBusy);
 document.querySelectorAll('.version-trigger').forEach(button=>button.disabled=remoteBusy||pendingTasks.has(button.dataset.moduleId)||!!downloadTask(button.dataset.moduleId));
 positionHistory();
}
function render(data){
 const changed=i18n.setLocale(data.locale||navigator.language);
 if(changed){lastModules='';lastRepositories='';renderRepositoryRows();closeHistory();tabText();}
 state=data;renderLanguage();$('version').textContent=data.version;renderAppUpdate();renderAutoStart();renderProxy();renderRepositories();
 const context=JSON.stringify([data.proxy,data.wallpaper_repositories,data.online?.catalog,data.online?.checked_at]);if(context!==historyContext){historyContext=context;resetHistory();}
 for(const [id,notice] of historyDownloads){const module=data.modules.find(module=>module.id===id),task=downloadTask(id);if(!task&&module?.source==='online'&&module.version===notice.version){historyDownloads.delete(id);toast(notice.name+t('已替换为 v')+notice.version,3000);}}
 const monitor=data.displays.find(d=>d.id===data.selected_monitor),playing=current();
 const visibleError=localError||data.last_error||(activeTab==='local'?remoteError:'');$('error').hidden=!visibleError;$('error').textContent=errorText(visibleError);
 $('auto-pause').checked=data.auto_pause;
 $('current-title').textContent=playing?contentText(playing):t('该屏幕尚未设置动态壁纸');
 $('current-status').textContent=playing?(playing.paused?t('已暂停'):playing.auto_paused?t('遮挡，自动暂停'):t('正在播放')):'';
 renderResources(playing);
 $('status-dot').classList.toggle('playing',!!playing&&!playing.paused&&!playing.auto_paused);
 $('pause').hidden=!playing;$('pause').textContent=playing?.paused?t('继续'):t('暂停');$('pause').dataset.paused=String(!!playing?.paused);
 $('current-monitor').textContent=monitor?.name||t('没有可用的显示器');
 const currentModule=data.modules.find(m=>m.id===playing?.module_id),artUrl=currentModule?.cover?data.service+currentModule.cover:'';
 const artSig=JSON.stringify([currentModule?.id,artUrl]);
 if(artSig!==lastCurrentArt){$('current-art').replaceChildren();if(artUrl){const img=el('img');img.src=artUrl;img.alt='';img.onerror=()=>img.replaceWith(el('span','','▱'));$('current-art').append(img);}else $('current-art').append(el('span','','▱'));lastCurrentArt=artSig;}
 $('module-count').textContent=String(data.modules.length).padStart(2,'0');
 renderDisplays(data);
 const moduleSig=JSON.stringify([i18n.locale,data.modules,data.selected_monitor,monitor?.name,playing?.module_id,data.service]);
 if(moduleSig!==lastModules){reconcile($('modules'),data.modules,m=>m.id,m=>JSON.stringify([i18n.locale,m,data.service,data.selected_monitor,monitor?.name,playing?.module_id]),module=>{
  const used=playing?.module_id===module.id,card=el('article','module'+(used?' active':'')),art=el('div','module-art');
  const cover=el('button','cover-button apply-cover');cover.dataset.available=String(!!monitor&&!used);cover.setAttribute('aria-label',t('将{name}应用到{monitor}',{name:contentText(module),monitor:monitor?.name||t('当前屏幕')}));cover.onclick=()=>applyWallpaper(module.id);image(cover,module.cover?data.service+module.cover:null,contentText(module));art.append(cover);
  if(used)art.append(el('span','used',t('✓ 使用中')));
  const preview=el('button','wallpaper-preview',t('▶ 预览'));preview.setAttribute('aria-label',t('预览')+contentText(module));preview.onclick=()=>previewWallpaper(module.id);art.append(preview);card.append(art);
  const copy=el('div','module-copy'),main=el('div','module-main'),text=el('div','module-text');text.append(el('h3','',contentText(module)));const description=el('p','',contentText(module,'description'));description.title=contentText(module,'description');text.append(description);main.append(text);
  if(!used){const apply=el('button','apply',t('应用壁纸'));apply.dataset.available=String(!!monitor);apply.title=t('应用到 ')+(monitor?.name||t('当前屏幕'));apply.onclick=()=>applyWallpaper(module.id);main.append(apply);}
  copy.append(main);taskSlot(copy,module.id);copy.append(moduleDetails(module));card.append(copy);return card;
 });$('empty').hidden=data.modules.length>0;lastModules=moduleSig;}
 const warnings=data.warnings||[];$('warnings-box').hidden=!warnings.length;$('warnings').replaceChildren(...warnings.map(message=>el('li','',errorText(message))));
 const online=data.online||{},catalog=online.catalog,items=catalog?.wallpapers||[];
 const updates=items.filter(item=>{const local=data.modules.find(m=>m.id===item.id);return local&&compare(item.version,local.version)>0;}).length;
 $('update-count').textContent=updates?t('{count} 可更新',{count:updates}):items.length?String(items.length):'';
 const onlineError=remoteError||online.last_error||online.lastError||'';$('online-error').hidden=!onlineError;$('online-error').textContent=errorText(onlineError);
 const checked=online.checked_at??online.checkedAt??0,enabled=enabledRepositories();
 $('online-status').textContent=!enabled.length?t('尚未启用壁纸仓库，可在设置中开启。'):checked?t('{count} 张壁纸 · 按需下载{cached}',{count:items.length,cached:online.cached?t(' · 缓存清单'):''}):t('已启用 {count} 个仓库，下载后可离线播放。',{count:enabled.length});$('online-status').title=checked?t('上次检查 ')+new Date(checked*1000).toLocaleString(i18n.locale):t('刷新只获取清单，不会自动下载壁纸');
 const taskItems=new Map(downloadTasks().map(t=>[t.id,t.item]));
 const listed=new Map(items.map(item=>[item.id,item]));taskItems.forEach((item,id)=>listed.set(id,item));
 const visibleItems=[...listed.values()].filter(item=>!taskFilter||taskItems.has(item.id));
 reconcile($('online-modules'),visibleItems,item=>item.id,item=>JSON.stringify([i18n.locale,item,data.modules.find(m=>m.id===item.id),data.version,data.service,data.selected_monitor,playing?.module_id,data.proxy]),item=>{
  const local=data.modules.find(m=>m.id===item.id),compatible=compare(data.version,item.minAppVersion||item.min_app_version||'0.2.0')>=0;
  const newer=local&&compare(item.version,local.version)>0,current=local?.source==='online'&&compare(item.version,local.version)===0;
  const card=el('article','module online-card');card.title=contentText(item,'description')+(item.repository?t('\n来源：')+repositoryLabel(item.repository):'');if(local?.cover)image(card,data.service+local.cover,contentText(item));else onlineImage(card,item,data);
  const copy=el('div','module-copy'),heading=el('div','module-heading');heading.append(el('h3','',contentText(item)));copy.append(heading);
  const used=current&&playing?.module_id===item.id;
  const text=!compatible?t('需要程序 ')+(item.minAppVersion||item.min_app_version):used?t('正在使用'):current?t('应用壁纸'):newer?t('更新到 v')+item.version:local?.source==='builtin'?t('下载独立副本'):t('下载壁纸');
  const download=el('button','apply download');download.setAttribute('aria-label',text);download.title=text;
  const icon=el('span','online-action-icon',current?'✓':'↓');icon.setAttribute('aria-hidden','true');download.append(icon,el('span','',!compatible?t('需升级'):used?t('使用中'):current?t('应用'):newer?t('更新'):t('下载')));
  download.dataset.available=String(compatible&&(!current||!!monitor&&!used));download.dataset.actionApply=String(current);download.dataset.moduleId=item.id;download.onclick=()=>current?applyWallpaper(item.id):changeDownload(item.id);heading.append(download);
  const meta=el('div','module-meta online-meta'),shown=taskItems.has(item.id)?item.version:local?.source==='online'?local.version:item.version;
  const version=el('button','version-trigger');version.append(el('span','','v'+shown),el('span','version-chevron','⌄'));version.dataset.moduleId=item.id;version.setAttribute('aria-label',contentText(item)+t('版本，当前 v')+shown);version.setAttribute('aria-haspopup','listbox');version.setAttribute('aria-controls','wallpaper-versions');version.setAttribute('aria-expanded','false');
  version.onclick=()=>openHistory(items.find(latest=>latest.id===item.id)||item,version);version.onkeydown=event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();openHistory(items.find(latest=>latest.id===item.id)||item,version,true);}};
  const remembered=historyPages.get(JSON.stringify([item.repository,item.id]))?.items.get(shown),size=remembered?.size||(shown===item.version?item.size:0);
  meta.append(version);if(size)meta.append(el('span','meta-dot','·'),el('span','',bytes(size)));
  if(item.repository){const source=el('span','online-source',repositoryName(item.repository));source.title=t('来源：')+repositoryLabel(item.repository);meta.append(el('span','meta-dot','·'),source);}
  if(local)meta.append(el('span','online-local',local.source==='builtin'?t('内置'):t('已下载')));
  copy.append(meta);taskSlot(copy,item.id);card.append(copy);return card;
 });
 $('online-empty').hidden=visibleItems.length>0;$('online-empty').textContent=!enabled.length&&!taskFilter?t('请在设置中添加或启用壁纸仓库。'):taskFilter?t('当前任务已完成，可以显示全部壁纸。'):t('暂时没有可浏览的壁纸，请刷新壁纸库。');
 renderDownloads();
 renderBusy();
}
async function update(){
 if(document.hidden)return;
 if(polling){refreshRequested=true;return;}
 polling=true;
 const epoch=renderEpoch;
 try{const data=await invoke('get_state');if(epoch===renderEpoch)render(data);}
 catch(error){if(epoch===renderEpoch){localError=String(error);$('error').hidden=false;$('error').textContent=errorText(localError);}}
 finally{polling=false;if(refreshRequested){refreshRequested=false;queueMicrotask(update);}}
}
function tabText(){$('collection-title').textContent=activeTab==='local'?t('我的壁纸'):t('发现壁纸');$('collection-description').textContent=activeTab==='local'?t('喜欢的风景，随时在身边。'):t('给桌面，添一点新鲜感。');}
function tab(name,refreshOnline=true){if(name==='local')taskFilter=false;activeTab=name;tabText();$('module-count').hidden=name!=='local';for(const value of ['local','online']){$(value+'-panel').hidden=value!==name;$('tab-'+value).classList.toggle('selected',value===name);$('tab-'+value).setAttribute('aria-pressed',String(value===name));}if(state)render(state);if(name==='online'&&refreshOnline&&enabledRepositories().length&&!remoteBusy)run('check_online',{},'',true);}
$('download-filter').onclick=()=>{taskFilter=!taskFilter;tab('online',false);};
$('clear-download-filter').onclick=()=>{taskFilter=false;if(state)render(state);};
$('tab-local').onclick=()=>tab('local');$('tab-online').onclick=()=>tab('online');
$('check-online').onclick=()=>run('check_online',{},'',true);
$('refresh').onclick=()=>run('refresh_modules',{},t('本地壁纸列表已更新'));
$('open-folder').onclick=()=>invoke('open_wallpaper_folder').catch(error=>toast(String(error)));
for(const [id,kind] of [['import-folder','folder'],['import-zip','zip']])$(id).onclick=async()=>{
 if(localBusy)return;$('import-error').hidden=true;
 const result=await run('import_wallpaper',{kind},t('壁纸已导入'));
 if(result){$('settings-dialog').close();tab('local');}
 else if(localError){$('import-error').textContent=errorText(localError);$('import-error').hidden=false;}
};
$('pause').onclick=()=>{const selected=current();if(selected)run('pause_wallpaper',{monitorId:state.selected_monitor,paused:!selected.paused});};
$('remove').onclick=()=>{closePlaybackMenu();run('remove_wallpaper',{monitorId:state.selected_monitor},t('已恢复该屏幕的原桌面'));};
$('auto-pause').onchange=()=>run('auto_pause',{enabled:$('auto-pause').checked});
$('language').onchange=()=>setLanguage($('language').value);
$('auto-start').onchange=()=>setAutoStart($('auto-start').checked);
$('preview').onclick=()=>{closePlaybackMenu();direct('capture_desktop',{monitorId:state.selected_monitor},t('桌面预览已保存'));};
$('reload').onclick=()=>{closePlaybackMenu();const playing=current();if(playing)run('apply_wallpaper',{monitorId:state.selected_monitor,moduleId:playing.module_id},t('壁纸已重新加载'));};
$('show-desktop').onclick=()=>{closePlaybackMenu();direct('show_desktop',{monitorId:state.selected_monitor});};
$('hide').onclick=()=>{closePlaybackMenu();direct('hide_manager');};$('quit').onclick=()=>direct('quit_app');
$('add-repository').onclick=()=>{repositoryDrafts.push({url:'',enabled:true});renderRepositoryRows();editRepositories();$('repository-url-'+(repositoryDrafts.length-1)).focus();};
$('save-repositories').onclick=saveRepositories;
$('proxy-mode').onchange=editProxy;$('proxy-url').oninput=editProxy;
$('save-proxy').onclick=()=>runProxy(true);$('test-proxy').onclick=()=>runProxy(false);
$('settings-open').onclick=()=>openSettings();
const settingsTabs=[...document.querySelectorAll('[data-settings-tab]')];
settingsTabs.forEach(button=>button.onclick=()=>selectSettingsTab(button.dataset.settingsTab));
const settingsNav=document.querySelector('.settings-nav'),compactSettings=matchMedia('(max-width:620px)');
const orientSettings=()=>settingsNav.setAttribute('aria-orientation',compactSettings.matches?'horizontal':'vertical');orientSettings();compactSettings.addEventListener('change',orientSettings);
settingsNav.addEventListener('keydown',event=>{
 const index=settingsTabs.indexOf(event.target);if(index<0)return;
 const key=event.key;let next;
 if(key==='Home')next=0;else if(key==='End')next=settingsTabs.length-1;else if(['ArrowDown','ArrowRight'].includes(key))next=(index+1)%settingsTabs.length;else if(['ArrowUp','ArrowLeft'].includes(key))next=(index+settingsTabs.length-1)%settingsTabs.length;else return;
 event.preventDefault();selectSettingsTab(settingsTabs[next].dataset.settingsTab,true);
});
$('about-open').onclick=openAbout;
document.querySelectorAll('[data-about-link]').forEach(link=>link.onclick=event=>{event.preventDefault();direct('open_about_link',{link:link.dataset.aboutLink});});
window.__TAURI__.event.listen('show-about',openAbout).catch(error=>toast(t('关于入口暂时不可用：')+String(error)));
$('app-update-toggle').onclick=openAppUpdate;
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{
 if(event.target!==dialog)return;
 const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();
}));
document.addEventListener('click',event=>{if(!event.target.closest('#playback-menu'))closePlaybackMenu();if(!event.target.closest('#current-resources'))$('current-resources').open=false;if(!event.target.closest('#wallpaper-actions-menu'))$('wallpaper-actions-menu').open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('wallpaper-actions-menu').open){$('wallpaper-actions-menu').open=false;$('wallpaper-actions-menu').querySelector('summary').focus();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('playback-menu').open){closePlaybackMenu();$('playback-menu').querySelector('summary').focus();}if(event.key==='Escape'&&$('current-resources').open){$('current-resources').open=false;$('current-resources').querySelector('summary').focus();}});
$('check-app-update').onclick=()=>runAppUpdate('check_app_update');
$('download-app-update').onclick=()=>runAppUpdate('download_app_update');
$('install-app-update').onclick=()=>{
 const update=appUpdate();if(appUpdateBusy||update.phase!=='ready'||!update.version)return;
 runAppUpdate('install_app_update',{confirmed:true,version:update.version});
};
setInterval(update,1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});window.addEventListener('focus',update);update();
})();

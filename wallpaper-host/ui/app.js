(() => {
'use strict';
const invoke=window.__TAURI__.core.invoke;
let state=null,busy=false,lastDisplay='',lastModules='',toastTimer;
const $=id=>document.getElementById(id);
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function current(){return state?.wallpapers.find(w=>w.display_id===state.selected_monitor);}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000);}
async function action(command,args={},message){if(busy)return;busy=true;document.querySelectorAll('.apply').forEach(b=>b.disabled=true);try{const result=await invoke(command,args);if(result)render(result);if(message)toast(message);}catch(error){if(state)state.last_error=String(error);$('error').hidden=false;$('error').textContent=String(error);}finally{busy=false;lastModules='';if(state)render(state);}}
function render(data){
 state=data;
 $('service-state').classList.toggle('online',data.online);$('service-state').lastChild.textContent=data.online?'内容服务在线':'内容服务未连接';
 $('start-service').hidden=data.online;
 $('error').hidden=!data.last_error;if(data.last_error)$('error').textContent=data.last_error;
 $('auto-pause').checked=data.auto_pause;
 const monitor=data.displays.find(d=>d.id===data.selected_monitor),active=current();
 $('current-title').textContent=active?active.name:'该屏幕尚未设置动态壁纸';
 $('current-status').textContent=active?(active.paused?'已暂停':active.auto_paused?'遮挡，自动暂停':'正在播放'):'';
 $('status-dot').classList.toggle('playing',!!active&&!active.paused&&!active.auto_paused);
 $('pause').disabled=!active;$('pause').textContent=active?.paused?'继续':'暂停';$('remove').disabled=!active;
 $('target-label').textContent=monitor?'应用到 '+monitor.name:'';$('module-count').textContent=String(data.modules.length).padStart(2,'0');
 const displaySignature=JSON.stringify([data.displays,data.selected_monitor,data.wallpapers.map(w=>[w.display_id,w.module_id])]);
 if(displaySignature!==lastDisplay){
  const nodes=data.displays.map(display=>{
   const button=element('button','display'+(display.id===data.selected_monitor?' selected':''));button.setAttribute('aria-pressed',String(display.id===data.selected_monitor));button.setAttribute('aria-label','选择 '+display.name);
   const icon=element('span','monitor-icon'),copy=element('span');copy.append(element('strong','',display.name),element('small','',`${display.width} × ${display.height} · 缩放 ${Math.round(display.scale*100)}%`));button.append(icon,copy);if(display.id===data.selected_monitor)button.append(element('span','check','✓'));
   button.onclick=()=>action('select_monitor',{monitorId:display.id});return button;
  });$('displays').replaceChildren(...nodes);lastDisplay=displaySignature;
 }
 const moduleSignature=JSON.stringify([data.modules,data.selected_monitor,active?.module_id]);
 if(moduleSignature!==lastModules){
  const nodes=data.modules.map(module=>{
   const used=active?.module_id===module.id,card=element('article','module'+(used?' active':''));
   if(module.cover){const img=element('img','cover');img.src=data.service+module.cover;img.alt=module.name+'封面';card.append(img);}else card.append(element('div','cover-fallback',module.name));
   const copy=element('div','module-copy'),heading=element('div','module-heading');heading.append(element('h3','',module.name));if(used)heading.append(element('span','used','正在使用'));copy.append(heading);
   if(module.subtitle)copy.append(element('div','subtitle',module.subtitle));copy.append(element('p','',module.description));
   const apply=element('button','apply',used?'重新应用壁纸':'设为该屏幕壁纸');apply.disabled=busy||!data.online||!monitor;apply.onclick=()=>action('apply_wallpaper',{monitorId:data.selected_monitor,moduleId:module.id},module.name+' 已设为 '+monitor.name+' 的背景');copy.append(apply);card.append(copy);return card;
  });$('modules').replaceChildren(...nodes);$('empty').hidden=nodes.length>0;lastModules=moduleSignature;
 }
}
async function update(){if(busy||document.hidden)return;try{render(await invoke('get_state'));}catch(error){$('error').hidden=false;$('error').textContent=String(error);}}
$('refresh').onclick=()=>action('refresh_modules',{},'壁纸列表已更新');
$('start-service').onclick=async()=>{const button=$('start-service');button.disabled=true;button.textContent='正在启动…';try{await action('start_content_service',{},'内容服务已启动');}finally{button.disabled=false;button.textContent='启动内容服务';}};
$('pause').onclick=()=>{const active=current();if(active)action('pause_wallpaper',{monitorId:state.selected_monitor,paused:!active.paused});};
$('remove').onclick=()=>action('remove_wallpaper',{monitorId:state.selected_monitor},'已恢复该屏幕的原桌面');
$('auto-pause').onchange=()=>action('auto_pause',{enabled:$('auto-pause').checked});
$('preview').onclick=async()=>{try{const file=await invoke('capture_desktop',{monitorId:state.selected_monitor});$('preview').title=file;toast('桌面预览已保存');}catch(error){toast(String(error));}};
$('show-desktop').onclick=async()=>{try{await invoke('show_desktop',{monitorId:state.selected_monitor});}catch(error){toast(String(error));}};
$('hide').onclick=()=>invoke('hide_manager');$('quit').onclick=()=>invoke('quit_app');
setInterval(update,2000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});window.addEventListener('focus',update);update();
})();

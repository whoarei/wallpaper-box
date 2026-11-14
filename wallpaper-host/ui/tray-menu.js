(() => {
 'use strict';
 const $=id=>document.getElementById(id),invoke=(command,args)=>window.__TAURI__.core.invoke(command,args);
 // Only these bundled paths enter SVG markup. Every native/wallpaper label is text.
 const paths={
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  monitor:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  pause:'<path d="M8 5v14M16 5v14"/>',play:'<path d="m8 4 12 8-12 8Z"/>',
  settings:'<path d="m10 3-.5 2-2 1.2-2-.6-2 3.4L5 10.5v3L3.5 15l2 3.4 2-.6 2 1.2.5 2h4l.5-2 2-1.2 2 .6 2-3.4-1.5-1.5v-3L20.5 9l-2-3.4-2 .6-2-1.2L14 3Z"/><circle cx="12" cy="12" r="3"/>',
  'auto-pause':'<path d="M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4M10 9v6m4-6v6"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  power:'<path d="M12 3v9m-5-7a9 9 0 1 0 10 0"/>',
  sparkles:'<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3ZM20 2v4m-2-2h4"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',check:'<path d="m5 12 4 4L19 6"/>',chevron:'<path d="m9 6 6 6-6 6"/>'
 };
 function icon(name,className){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class',className);svg.innerHTML=paths[name]||paths.image;return svg;}
 let state=null,path=[],busy=false,epoch=0,pendingReady=false,typeahead='',typeaheadAt=0;
 const menu=$('menu');
 function english(){return state?.locale==='en';}
 function error(message){$('menu-error').textContent=String(message);$('menu-error').hidden=false;}
 async function hide(){try{await invoke('tray_menu_hide');}catch(message){error(message);}}
 function level(){let items=state.items,parents=[];for(const id of path){const item=items.find(item=>item.id===id&&item.enabled&&item.children.length);if(!item)break;parents.push(item);items=item.children;}path=parents.map(item=>item.id);return {items,parents};}
 function buttons(){return [...menu.querySelectorAll('button:enabled')];}
 function focus(button){if(!button)return;menu.querySelectorAll('button').forEach(item=>item.tabIndex=-1);button.tabIndex=0;button.focus({preventScroll:true});button.scrollIntoView({block:'nearest'});}
 function render(focusId,moveFocus=false){
  document.documentElement.lang=state.locale;document.title=state.brand;document.querySelector('.tray-card').setAttribute('aria-label',state.brand);
  $('brand').textContent=state.brand;$('version').textContent='v'+state.version;
  $('wallpaper').textContent=state.wallpaper;$('wallpaper').title=state.wallpaper;$('display').textContent=state.display;$('display').title=state.display;
  $('status').textContent=state.status;$('status').classList.toggle('playing',state.playing);
  $('back-label').textContent=english()?'Back':'返回';$('footer-label').textContent=english()?'A little scenery, always close':'让喜欢的风景常在';$('dismiss-label').textContent=english()?'Close':'关闭';
  const {items,parents}=level();$('submenu-nav').hidden=!parents.length;$('submenu-title').textContent=parents.at(-1)?.label||'';
  menu.setAttribute('aria-label',parents.at(-1)?.label||(english()?'Quick actions':'快捷操作'));
  menu.replaceChildren();
  for(const item of items){
   if(!item.id){const separator=document.createElement('div');separator.className='menu-separator';separator.setAttribute('role','separator');menu.append(separator);continue;}
   const button=document.createElement('button');button.type='button';button.className='menu-item'+(item.id==='open-manager'?' primary':item.id==='quit'?' danger':'');button.dataset.id=item.id;button.disabled=!item.enabled;button.tabIndex=-1;
   button.setAttribute('role',item.checked===null?'menuitem':'menuitemcheckbox');if(item.checked!==null)button.setAttribute('aria-checked',String(item.checked));
   button.append(icon(item.icon,'item-icon'));const label=document.createElement('span');label.className='item-label';label.textContent=item.label;button.append(label);
   if(item.children.length){button.setAttribute('aria-haspopup','menu');button.append(icon('chevron','item-tail'));}
   else if(item.checked){button.append(icon('check','item-tail'));}
   button.onclick=()=>activate(item);menu.append(button);
  }
  const target=buttons().find(button=>button.dataset.id===focusId)||buttons()[0];if(target)target.tabIndex=0;
  if(moveFocus)focus(target);
 }
 function back(){const id=path.pop();if(id)render(id,true);}
 async function activate(item){
  if(busy||!item.enabled)return;
  if(item.children.length){path.push(item.id);render(null,true);return;}
  busy=true;$('menu-error').hidden=true;
  try{await invoke('tray_menu_action',{id:item.id,generation:state.generation});}
  catch(message){error(message);busy=false;await load(false);}
 }
 async function load(open){
  pendingReady ||= open;const ticket=++epoch;
  try{
   const next=await invoke('tray_menu_state');if(ticket!==epoch)return;
   const reset=!state||state.generation!==next.generation;
   const focused=menu.contains(document.activeElement),focusId=document.activeElement?.dataset?.id;
   if(reset){path=[];busy=false;$('menu-error').hidden=true;}
   state=next;render(focusId,focused||reset);
   if(pendingReady){pendingReady=false;await invoke('tray_menu_ready',{generation:state.generation});}
  }catch(message){if(ticket===epoch)error(message);}
 }
 $('back').onclick=back;
 document.querySelector('.wallpaper-symbol').append(icon('image',''));
 document.addEventListener('contextmenu',event=>event.preventDefault());
 document.addEventListener('pointerdown',event=>{if(event.target===document.body)hide();});
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();hide();return;}
  if(event.key==='ArrowLeft'&&path.length){event.preventDefault();back();return;}
  const items=buttons(),index=items.indexOf(document.activeElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;focus(items[next]);
  }else if(event.key==='ArrowRight'&&document.activeElement?.getAttribute('aria-haspopup')==='menu'){event.preventDefault();document.activeElement.click();}
  else if(event.key==='Tab'){event.preventDefault();const all=[...document.querySelectorAll('#back:not(:disabled),#menu button:enabled')].filter(button=>!button.closest('[hidden]'));const current=all.indexOf(document.activeElement);focus(all[(current+(event.shiftKey?-1:1)+all.length)%all.length]);}
  else if(event.key.length===1&&event.key!==' '&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
   typeahead=Date.now()-typeaheadAt>700?event.key:typeahead+event.key;typeaheadAt=Date.now();
   focus([...items.slice(index+1),...items.slice(0,index+1)].find(button=>button.textContent.toLocaleLowerCase().startsWith(typeahead.toLocaleLowerCase())));
  }
 });
 (async()=>{
  await window.__TAURI__.event.listen('tray-menu-open',()=>load(true));
  await window.__TAURI__.event.listen('tray-menu-updated',()=>load(false));
  await window.__TAURI__.event.listen('host-updated',()=>load(false));
  await load(true);
 })().catch(error);
})();

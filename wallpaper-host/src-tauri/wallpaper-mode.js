(() => {
  // The host freezes the entire animation scheduler, including modules that keep
  // repainting while their own simulation is paused. No module-specific SDK needed.
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const pending = new Map(), scheduled = new Map();
  let paused = false, sequence = 0;
  function schedule(id) {
    if (paused || !pending.has(id) || scheduled.has(id)) return;
    scheduled.set(id, nativeRaf(timestamp => {
      scheduled.delete(id);
      if (paused) return;
      const callback = pending.get(id); pending.delete(id);
      if (callback) callback(timestamp);
    }));
  }
  window.requestAnimationFrame = callback => { const id=++sequence;pending.set(id,callback);schedule(id);return id; };
  window.cancelAnimationFrame = id => { if(scheduled.has(id))nativeCancel(scheduled.get(id));scheduled.delete(id);pending.delete(id); };
  window.__SCREEN_GARDEN_SET_PAUSED = value => {
    value=!!value;if(paused===value)return;paused=value;
    if(paused){for(const handle of scheduled.values())nativeCancel(handle);scheduled.clear();}
    else{document.dispatchEvent(new Event('visibilitychange'));for(const id of pending.keys())schedule(id);}
    document.documentElement.dataset.wallpaperPaused=String(paused);
  };
  // The native host has already checked desktop/Explorer hit testing, drag
  // distance and manual pause. Normalized coordinates handle every monitor DPI.
  function desktopTarget(u,v) {
    if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>=1||v<0||v>=1||document.readyState==='loading')return {delivered:false};
    const x=Math.floor(u*innerWidth),y=Math.floor(v*innerHeight),target=document.elementFromPoint(x,y);
    return target ? {x,y,target} : {delivered:false};
  }
  // Only validated desktop movement reaches this bridge. Synthetic movement
  // wakes the page without focusing the WebView or generating a scene click.
  window.__SCREEN_GARDEN_DESKTOP_MOVE = (u,v) => {
    const {x,y,target}=desktopTarget(u,v);
    if(!target)return {delivered:false};
    target.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true,view:window,clientX:x,clientY:y,buttons:0,pointerId:1,pointerType:'mouse',isPrimary:true}));
    return {delivered:true};
  };
  window.__SCREEN_GARDEN_DESKTOP_CLICK = (u,v) => {
    const {x,y,target}=desktopTarget(u,v);
    if(!target)return {delivered:false};
    const before=window.aquarium?.getState?.().totalFed;
    const options={bubbles:true,cancelable:true,composed:true,view:window,clientX:x,clientY:y,button:0,detail:1};
    try {
      target.dispatchEvent(new PointerEvent('pointerdown',{...options,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true}));
      target.dispatchEvent(new MouseEvent('mousedown',{...options,buttons:1}));
      target.dispatchEvent(new PointerEvent('pointerup',{...options,buttons:0,pointerId:1,pointerType:'mouse',isPrimary:true}));
      target.dispatchEvent(new MouseEvent('mouseup',{...options,buttons:0}));
      if(!target.isConnected)return {delivered:false};
      target.dispatchEvent(new MouseEvent('click',{...options,buttons:0}));
      const reply={delivered:true,x,y};
      if(before!==undefined){const after=window.aquarium.getState();reply.added=after.totalFed-before;reply.totalFed=after.totalFed;reply.foods=after.foods;}
      return reply;
    }catch{return {delivered:false};}
  };
  function wallpaperStyle() {
    const style=document.createElement('style');
    style.textContent=`
      .hud,.overlay,.toast,.help-panel,.pause-badge{display:none!important}
      html,body{cursor:default!important}
      html[data-screen-garden-controls="pinewind"] .overlay.dock{display:flex!important}
      html[data-screen-garden-controls="pinewind"] .help-panel.open,
      html[data-screen-garden-controls="pinewind"] .toast.show{display:block!important}
      html[data-screen-garden-controls="pinewind"] #fullscreen{display:none!important}
    `;
    (document.head||document.documentElement).append(style);
    document.documentElement.dataset.screenGardenWallpaper='true';
  }
  // Adapt the existing module here so installed/downloaded copies also work;
  // other wallpapers keep their existing desktop presentation.
  function wallpaperControls() {
    const dock=document.querySelector('nav.overlay.dock'),help=document.getElementById('helpPanel');
    if(!window.pinewind||!dock||!help)return;
    document.documentElement.dataset.screenGardenControls='pinewind';
    for(const button of dock.querySelectorAll('button[title]'))button.title=button.title.replace(/（[DRTFH]）/g,'');
    const instructions=help.querySelector('p');
    if(instructions)instructions.innerHTML='点击桌面空白草地，种下一簇花。<br>点击房子，开一盏暖灯。<br>使用下方按钮切换昼夜、天气或召唤火车。<br><br>移动鼠标到桌面空白处，可唤回控制栏；静止片刻后自动淡出。<br>暂停 / 继续请使用壁纸盒子或托盘菜单。<br>桌面图标照常操作。';
  }
  if(document.documentElement)wallpaperStyle();else document.addEventListener('DOMContentLoaded',wallpaperStyle,{once:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wallpaperControls,{once:true});else wallpaperControls();
})();

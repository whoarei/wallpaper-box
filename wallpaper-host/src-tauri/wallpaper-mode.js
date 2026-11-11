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
  window.__SCREEN_GARDEN_DESKTOP_CLICK = (u,v) => {
    if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>=1||v<0||v>=1||document.readyState==='loading')return {delivered:false};
    const x=Math.floor(u*innerWidth),y=Math.floor(v*innerHeight),target=document.elementFromPoint(x,y);
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
    style.textContent='.hud,.overlay,.toast,.help-panel,.pause-badge{display:none!important}html,body{cursor:default!important}';
    (document.head||document.documentElement).append(style);
    document.documentElement.dataset.screenGardenWallpaper='true';
  }
  if(document.documentElement)wallpaperStyle();else document.addEventListener('DOMContentLoaded',wallpaperStyle,{once:true});
})();

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
  function wallpaperStyle() {
    const style=document.createElement('style');
    style.textContent='.hud,.overlay,.toast,.help-panel,.pause-badge{display:none!important}html,body{cursor:default!important}';
    (document.head||document.documentElement).append(style);
    document.documentElement.dataset.screenGardenWallpaper='true';
  }
  if(document.documentElement)wallpaperStyle();else document.addEventListener('DOMContentLoaded',wallpaperStyle,{once:true});
})();

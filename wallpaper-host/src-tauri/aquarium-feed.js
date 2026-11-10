(() => {
  // Reuse the module's existing button so food limits, pause rules, fish
  // attraction and ripples stay identical in browser and desktop modes.
  const button = document.getElementById('feed');
  if (!button || !window.aquarium?.getState) {
    return {ok: false, message: '水族箱正在载入，请稍后再投喂。'};
  }
  const before = window.aquarium.getState();
  if (before.paused) return {ok: false, message: '水族箱已暂停，请先继续播放。'};
  button.click();
  const after = window.aquarium.getState();
  if (after.totalFed <= before.totalFed) {
    return {ok: false, message: '先让鱼儿慢慢吃完这一餐。'};
  }
  return {ok: true, foods: after.foods, totalFed: after.totalFed};
})();

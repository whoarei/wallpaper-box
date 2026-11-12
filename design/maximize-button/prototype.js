(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const app = $('app-window');
  const maximize = $('maximize-button');
  let maximized = false;
  let scene = 'aquarium';
  let paused = false;
  let secondary = false;
  let noticeTimer;

  function setMaximized(value) {
    maximized = value;
    app.classList.toggle('is-maximized', value);
    const label = value ? '还原' : '最大化';
    maximize.setAttribute('aria-label', label);
    maximize.setAttribute('data-tooltip', label);
    maximize.setAttribute('aria-pressed', String(value));
    maximize.querySelector('use').setAttribute('href', value ? '#i-restore' : '#i-maximize');
    $('window-mode').textContent = value ? '已最大化' : '窗口模式';
  }

  function notice(message) {
    clearTimeout(noticeTimer);
    $('demo-notice').textContent = message;
    $('demo-notice').hidden = false;
    noticeTimer = setTimeout(() => { $('demo-notice').hidden = true; }, 2400);
  }

  function showWindow() {
    app.hidden = false;
    $('desktop-reopen').hidden = true;
    $('window-mode').textContent = maximized ? '已最大化' : '窗口模式';
  }

  function hideWindow(kind) {
    app.hidden = true;
    $('desktop-reopen').hidden = false;
    $('reopen-label').textContent = kind === 'minimized' ? '窗口已最小化' : '已收起到托盘，壁纸继续播放';
    $('window-mode').textContent = kind === 'minimized' ? '已最小化' : '已收起到托盘';
    $('desktop-reopen').focus();
  }

  function setScene(value) {
    scene = value;
    document.querySelectorAll('.wallpaper-card').forEach(card => {
      const active = card.dataset.scene === scene;
      card.classList.toggle('active', active);
      card.querySelector('.in-use').hidden = !active;
      card.querySelector('.apply-button').textContent = active ? '已应用' : '应用壁纸';
    });
    $('player-cover').src = `../../wallpapers/${scene}/cover.jpg`;
    $('player-title').textContent = scene === 'aquarium' ? '水族箱' : '松风镇';
    $('feed-button').hidden = scene !== 'aquarium';
  }

  maximize.addEventListener('click', () => setMaximized(!maximized));
  $('titlebar').addEventListener('dblclick', event => {
    if (!event.target.closest('button,nav')) setMaximized(!maximized);
  });
  $('minimize-button').addEventListener('click', () => hideWindow('minimized'));
  $('close-button').addEventListener('click', () => hideWindow('tray'));
  $('desktop-reopen').addEventListener('click', () => {
    showWindow();
    maximize.focus({ preventScroll: true });
  });
  $('reset-demo').addEventListener('click', () => {
    showWindow();
    setMaximized(false);
    setScene('aquarium');
    paused = false;
    secondary = false;
    $('pause-button').textContent = 'Ⅱ 暂停';
    $('play-state').textContent = '正在播放';
    $('monitor-label').textContent = $('player-monitor').textContent = '主显示器';
    $('demo-notice').hidden = true;
    document.querySelector('[data-tab="local"]').click();
  });
  document.querySelectorAll('[data-apply]').forEach(button => {
    button.addEventListener('click', () => setScene(button.dataset.apply));
  });
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-tab]').forEach(tab => {
        const selected = tab === button;
        tab.classList.toggle('selected', selected);
        tab.setAttribute('aria-pressed', String(selected));
      });
      const local = button.dataset.tab === 'local';
      $('collection-title').innerHTML = `${local ? '我的壁纸' : '发现壁纸'} <span>02</span>`;
      $('collection-description').textContent = local ? '喜欢的风景，随时在身边。' : '来自官方壁纸库，下载后可离线播放。';
    });
  });
  $('pause-button').addEventListener('click', () => {
    paused = !paused;
    $('pause-button').textContent = paused ? '▶ 继续' : 'Ⅱ 暂停';
    $('play-state').textContent = paused ? '已暂停' : '正在播放';
  });
  $('monitor-button').addEventListener('click', () => {
    secondary = !secondary;
    $('monitor-label').textContent = $('player-monitor').textContent = secondary ? '副显示器' : '主显示器';
  });
  $('feed-button').addEventListener('click', () => notice(paused ? '请先继续播放，再投喂鱼儿。' : '已投喂鱼儿（原型演示）'));
  $('settings-button').addEventListener('click', () => notice('设置入口 · 本稿重点预览右上角的窗口控件。'));
  $('import-button').addEventListener('click', () => notice('导入壁纸入口 · 此处为界面示意。'));
  $('more-button').addEventListener('click', () => notice('窗口关闭后会收起到托盘，壁纸继续播放。'));

  // The desktop stage is a visual simulation. It never calls native window APIs.
  document.addEventListener('pointerdown', event => {
    app.classList.toggle('is-inactive', !app.contains(event.target));
  });
  document.addEventListener('focusin', event => {
    app.classList.toggle('is-inactive', !app.contains(event.target));
  });
  window.addEventListener('blur', () => app.classList.add('is-inactive'));
  window.addEventListener('focus', () => app.classList.remove('is-inactive'));
})();

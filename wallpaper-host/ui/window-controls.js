(() => {
  'use strict';
  const t=window.wallpaperI18n.t;
  const currentWindow = window.__TAURI__.window.getCurrentWindow();
  const maximize = document.getElementById('window-maximize');
  const unlisteners = [];
  let disposed = false;
  let revision = 0;
  let toggling = false;

  function report(action, error) {
    if (!disposed) window.dispatchEvent(new CustomEvent('window-control-error', {
      detail: t('{action}失败，请重试。{error}',{action,error:String(error)}),
    }));
  }

  // Read native state rather than guessing from viewport size or the last click.
  // A newer event invalidates any still-pending state read.
  async function syncState() {
    const reading = ++revision;
    const [maximized, focused] = await Promise.all([
      currentWindow.isMaximized(), currentWindow.isFocused(),
    ]);
    if (disposed || reading !== revision) return;
    const label = maximized ? t('还原') : t('最大化');
    maximize.setAttribute('aria-label', label);
    maximize.setAttribute('title', label);
    maximize.setAttribute('aria-pressed', String(maximized));
    maximize.querySelector('.maximize-icon').toggleAttribute('hidden', maximized);
    maximize.querySelector('.restore-icon').toggleAttribute('hidden', !maximized);
    document.body.classList.toggle('window-maximized', maximized);
    document.body.classList.toggle('window-inactive', !focused);
  }

  function refresh() {
    return syncState().catch(error => report(t('读取窗口状态'), error));
  }

  async function toggleMaximize() {
    if (toggling) return;
    toggling = true;
    try {
      await currentWindow.toggleMaximize();
      await syncState();
    } catch (error) {
      report(t('切换窗口大小'), error);
    } finally {
      toggling = false;
    }
  }

  maximize.addEventListener('click', toggleMaximize);
  document.getElementById('window-minimize').addEventListener('click', () => {
    currentWindow.minimize().catch(error => report(t('最小化窗口'), error));
  });
  document.getElementById('window-close').addEventListener('click', () => {
    // Keep the established close-to-tray behavior; do not destroy the WebView.
    window.__TAURI__.core.invoke('hide_manager').catch(error => report(t('收起窗口'), error));
  });

  const titlebar = document.querySelector('[data-window-drag]');
  const interactive = 'button,a,input,select,textarea,summary,[role="button"]';
  function startDragging() {
    currentWindow.startDragging().catch(error => report(t('移动窗口'), error));
  }
  titlebar.addEventListener('mousedown', event => {
    if (event.button !== 0 || event.target.closest(interactive)) return;
    event.preventDefault();
    // Handle the second mouse-down before native dragging consumes the gesture.
    // Do not also register dblclick: that would toggle the same gesture twice.
    if (event.detail === 2) toggleMaximize();
    else startDragging();
  });
  titlebar.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0 ||
        event.target.closest(interactive)) return;
    event.preventDefault();
    startDragging();
  });

  async function subscribe(listen) {
    const unlisten = await listen();
    if (disposed) unlisten();
    else unlisteners.push(unlisten);
  }

  // Subscribe before the initial read, including resize from Windows shortcuts
  // and focus changes when returning from the tray or moving between screens.
  Promise.all([
    subscribe(() => currentWindow.onResized(refresh)),
    subscribe(() => currentWindow.onFocusChanged(refresh)),
    subscribe(() => currentWindow.onScaleChanged(refresh)),
  ]).then(refresh).catch(error => {
    report(t('监听窗口状态'), error);
    refresh();
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('app:localechange', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pagehide', () => {
    disposed = true;
    revision++;
    unlisteners.forEach(unlisten => unlisten());
  }, { once: true });
})();

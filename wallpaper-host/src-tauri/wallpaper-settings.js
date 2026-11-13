// Included by a wallpaper's sandboxed settings.html. No native IPC is exposed.
(() => {
  'use strict';
  const channel = 'wallpaper-settings-v1';
  const session = new URLSearchParams(location.hash.slice(1)).get('wallpaper-settings');
  const pending = new Map();
  let sequence = 0, locale = 'zh-CN';
  function setLocale(next) {
    if (!['zh-CN', 'en'].includes(next) || locale === next) return;
    locale = next;
    window.dispatchEvent(new CustomEvent('wallpapersettings:localechange', {detail: {locale}}));
  }
  function request(method, payload = {}) {
    if (parent === window || !session) return Promise.reject(new Error('请在壁纸盒子的“壁纸设置”中打开此页面。'));
    if (pending.size >= 8) return Promise.reject(new Error('请求过于频繁，请稍后重试。'));
    const requestId = String(++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId); reject(new Error('配置请求超时，请重新打开设置页。'));
      }, 15000);
      pending.set(requestId, {resolve, reject, timer});
      parent.postMessage({channel, session, requestId, method, ...payload}, '*');
    });
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== parent || message?.channel !== channel || message.session !== session) return;
    if (message.type === 'localechange') { setLocale(message.locale); return; }
    if (message.ok) setLocale(message.result?.locale);
    const operation = pending.get(message.requestId); if (!operation) return;
    clearTimeout(operation.timer); pending.delete(message.requestId);
    if (message.ok) operation.resolve(message.result);
    else operation.reject(new Error(message.error || '无法处理壁纸配置。'));
  });
  Object.defineProperty(window, 'wallpaperSettings', {value: Object.freeze({
    get locale() { return locale; },
    load: () => request('load'),
    save: (settings, expectedRevision) => request('save', {settings, expectedRevision})
  }), writable: false, configurable: false});
})();

(() => {
  'use strict';
  const i18n = window.wallpaperI18n, t = i18n.t;
  const $ = id => document.getElementById(id), channel = 'wallpaper-settings-v1';
  let state = null, selected = '', optionsKey = '', context = null, statusKey = '', statusError = false;
  function status(message, error = false) {
    statusKey = message; statusError = error;
    const text = error ? i18n.message(message) : t(message);
    $('wallpaper-settings-status').textContent = text;
    $('wallpaper-settings-error').textContent = error ? text : '';
    $('wallpaper-settings-error').hidden = !error;
  }
  function close() {
    if (context) clearTimeout(context.timer);
    context = null;
    $('wallpaper-settings-frame').replaceChildren();
  }
  function render(data, active) {
    state = data;
    status(statusKey, statusError);
    const name = module => module.locales?.[i18n.locale]?.name || module.name;
    const modules = data?.modules || [];
    if (!modules.some(module => module.id === selected)) {
      selected = modules.find(module => module.id === data?.wallpapers.find(w => w.display_id === data.selected_monitor)?.module_id)?.id ||
        modules.find(module => module.settings)?.id || modules[0]?.id || '';
    }
    const signature = JSON.stringify(modules.map(module => [module.id, name(module)]));
    if (signature !== optionsKey) {
      optionsKey = signature;
      $('wallpaper-settings-select').replaceChildren(...modules.map(module => {
        const option = document.createElement('option'); option.value = module.id; option.textContent = name(module); return option;
      }));
    }
    $('wallpaper-settings-select').value = selected;
    $('wallpaper-settings-select').disabled = !modules.length;
    const module = modules.find(module => module.id === selected);
    $('wallpaper-settings-reload').disabled = !module?.settings;
    const key = JSON.stringify([module?.id, module?.settings_token, module?.settings?.entry, data?.service]);
    if (context && context.key !== key) close();
    if (!active) return;
    if (!module?.settings) {
      close(); $('wallpaper-settings-empty').hidden = false;
      $('wallpaper-settings-empty').textContent = t(module ? '此壁纸暂无自定义设置。' : '还没有已安装的壁纸。');
      status(''); return;
    }
    $('wallpaper-settings-empty').hidden = true;
    if (context) { context.frame.title = t('{name}的壁纸设置', {name: name(module)}); sendLocale(context); return; }
    const frame = document.createElement('iframe');
    frame.title = t('{name}的壁纸设置', {name: name(module)});
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    const session = crypto.randomUUID();
    context = {key, frame, session, moduleId: module.id, token: module.settings_token, busy: false};
    const mounted = context;
    mounted.timer = setTimeout(() => { if (context === mounted && !mounted.loaded) status('设置页未能就绪，请点击“重新加载”重试。', true); }, 15000);
    frame.src = data.service + '/' + encodeURIComponent(module.id) + '/' + module.settings.entry + '#wallpaper-settings=' + session;
    frame.addEventListener('load', () => { if (context === mounted) sendLocale(mounted); });
    frame.addEventListener('error', () => { if (context?.frame === frame) status('设置页加载失败，请重新选择壁纸后重试。', true); });
    $('wallpaper-settings-frame').replaceChildren(frame);
    status('正在加载壁纸设置…');
  }
  function sendLocale(target) {
    target.frame.contentWindow.postMessage({channel, session: target.session, type: 'localechange', locale: i18n.locale}, '*');
  }
  window.addEventListener('message', async event => {
    const current = context, message = event.data;
    if (!current || !$('settings-dialog').open || event.source !== current.frame.contentWindow || event.origin !== 'null' ||
        message?.channel !== channel || message.session !== current.session ||
        typeof message.requestId !== 'string' || !/^\d{1,16}$/.test(message.requestId)) return;
    const reply = value => {
      if (context === current) current.frame.contentWindow.postMessage({channel, session: current.session, requestId: message.requestId, ...value}, '*');
    };
    if (current.busy) { reply({ok: false, error: '正在处理上一个配置请求，请稍后再试。'}); return; }
    if (!['load', 'save'].includes(message.method)) { reply({ok: false, error: '不支持的配置操作。'}); return; }
    current.busy = true;
    try {
      const module = state.modules.find(module => module.id === current.moduleId);
      if (!module || module.settings_token !== current.token) throw new Error('壁纸已更新，请重新打开设置页。');
      const args = {moduleId: current.moduleId, pageToken: current.token};
      if (message.method === 'save') {
        const settings = message.settings;
        if (!settings || Array.isArray(settings) || typeof settings !== 'object' ||
            !Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0 ||
            new TextEncoder().encode(JSON.stringify(settings)).length > 32768) throw new Error('壁纸配置无效或超过 32 KiB。');
        Object.assign(args, {settings, expectedRevision: message.expectedRevision});
      }
      const result = await window.__TAURI__.core.invoke(message.method === 'load' ? 'get_wallpaper_settings' : 'set_wallpaper_settings', args);
      if (context !== current) return;
      current.loaded = true; clearTimeout(current.timer);
      if (message.method === 'save') status(result.pending ? '已保存，部分窗口将在就绪后同步。' :
        result.running ? '已保存，已通知正在运行的壁纸。' : '已保存，将在壁纸下次启动时生效。');
      else status('同一设备上的这张壁纸共用一份配置，保存后生效。');
      reply({ok: true, result: {...result, locale: i18n.locale}});
    } catch (error) {
      if (context === current) status(String(error.message || error), true);
      reply({ok: false, error: String(error.message || error)});
    } finally { current.busy = false; }
  });
  $('wallpaper-settings-select').addEventListener('change', () => {
    selected = $('wallpaper-settings-select').value; close(); render(state, true);
  });
  $('settings-dialog').addEventListener('close', close);
  $('wallpaper-settings-reload').addEventListener('click', () => { close(); render(state, true); });
  window.wallpaperSettingsPanel = Object.freeze({render, close});
})();

// Optional, local helper shipped with this wallpaper. No host DOM adapter needed.
(() => {
  'use strict';
  function context() {
    const host = window.wallpaperHost?.protocolVersion === 1 ? window.wallpaperHost : null;
    const legacy = !host && document.documentElement.dataset.screenGardenWallpaper === 'true';
    return {host, mode: host?.mode ?? (legacy ? 'desktop' : 'browser'),
      capabilities: host?.capabilities ?? {
        pointer: legacy ? 'relayed' : 'native', pointerMove: !legacy,
        keyboard: !legacy, fullscreen: !legacy && Boolean(document.fullscreenEnabled),
        pause: false, actions: false
      }};
  }
  function state() {
    return context().host?.getState() ?? {paused: false, pauseReason: 'none'};
  }
  function createActions(definitions) {
    const replies = new Map();
    const fail = (requestId, code, message) => ({ok: false, requestId, code, message});
    function descriptor(action) {
      const current = state();
      const blocked = current.paused &&
        (current.pauseReason !== 'occluded' || !action.allowWhenOccluded);
      const reason = blocked ? '壁纸已暂停，请先继续播放。' : action.disabledReason?.();
      return {id: action.id, label: action.label, enabled: !reason,
        ...(reason ? {disabledReason: reason} : {}),
        allowWhenOccluded: action.allowWhenOccluded === true};
    }
    return Object.freeze({
      protocolVersion: 1,
      getActions() {
        if (!context().capabilities.actions) return [];
        return definitions.map(descriptor);
      },
      invoke(request) {
        const id = typeof request?.requestId === 'string' ? request.requestId : '';
        const {host, capabilities} = context();
        if (!host || !capabilities.actions) return fail(id, 'UNSUPPORTED', '当前环境不支持主程序操作。');
        if (!request || request.protocolVersion !== 1 || !id || id.length > 128 ||
            typeof request.actionId !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(request.actionId) ||
            typeof request.instanceId !== 'string' || !request.instanceId || request.instanceId.length > 128) {
          return fail(id, 'INVALID_REQUEST', '壁纸操作请求无效。');
        }
        if (request.instanceId !== host.instanceId) return fail(id, 'STALE_INSTANCE', '壁纸已经重新加载。');
        const old = replies.get(id);
        if (old) return old.actionId === request.actionId ? JSON.parse(old.result) :
          fail(id, 'INVALID_REQUEST', '重复请求的内容不一致。');
        let result;
        try {
          const action = definitions.find(action => action.id === request.actionId);
          if (!action) result = fail(id, 'UNKNOWN_ACTION', '没有这个操作。');
          else {
            const current = state(), info = descriptor(action);
            if (!info.enabled) result = fail(id, current.paused ? 'PAUSED' : 'DISABLED', info.disabledReason);
            else {
              const reply = action.run();
              if (!reply || typeof reply.ok !== 'boolean' || typeof reply.then === 'function') throw new Error('Invalid result');
              result = {...reply, requestId: id};
            }
          }
        } catch {
          result = fail(id, 'RESULT_UNKNOWN', '未能确认操作结果，请查看当前画面，避免重复操作。');
        }
        const serialized = JSON.stringify(result);
        replies.set(id, {actionId: request.actionId, result: serialized});
        if (replies.size > 128) replies.delete(replies.keys().next().value);
        return JSON.parse(serialized);
      }
    });
  }
  function ready(callback) {
    if (document.readyState === 'complete') { callback(); return; }
    const run = () => {
      document.removeEventListener('DOMContentLoaded', run);
      window.removeEventListener('load', run);
      callback();
    };
    // Deferred modules run while readyState is interactive, before legacy host
    // DOMContentLoaded listeners have supplied their environment attributes.
    document.addEventListener('DOMContentLoaded', run, {once: true});
    window.addEventListener('load', run, {once: true});
  }
  window.wallpaperAdapter = Object.freeze({context, state, createActions, ready});
})();

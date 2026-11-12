// Evaluated once per document. No scene variables, selectors or page styles.
(config => {
  'use strict';
  const desktop = config.mode === 'desktop';
  const instanceId = crypto.randomUUID?.() ||
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const capabilities = Object.freeze({
    pointer: desktop ? 'relayed' : 'native', pointerMove: true,
    keyboard: !desktop, fullscreen: !desktop && Boolean(document.fullscreenEnabled),
    pause: desktop, actions: desktop
  });
  // Loading desktop documents remain suspended until native state is confirmed.
  let state = Object.freeze({paused: desktop, pauseReason: desktop ? 'system' : 'none'});
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const pending = new Map(), scheduled = new Map(), replies = new Map();
  let sequence = 0;
  const own = (name, value) => Object.defineProperty(window, name, {
    value, writable: false, configurable: false
  });
  own('wallpaperHost', Object.freeze({
    protocolVersion: 1, mode: config.mode, instanceId, capabilities, getState: () => state
  }));
  function attributes() {
    if (!document.documentElement || !desktop) return;
    document.documentElement.dataset.screenGardenWallpaper = 'true';
    document.documentElement.dataset.wallpaperPaused = String(state.paused);
  }
  attributes();
  document.addEventListener('DOMContentLoaded', attributes, {once: true});
  function schedule(id) {
    if (state.paused || !pending.has(id) || scheduled.has(id)) return;
    scheduled.set(id, nativeRaf(timestamp => {
      scheduled.delete(id);
      if (state.paused) return;
      const callback = pending.get(id); pending.delete(id);
      if (callback) callback(timestamp);
    }));
  }
  if (desktop) {
    window.requestAnimationFrame = callback => {
      const id = ++sequence; pending.set(id, callback); schedule(id); return id;
    };
    window.cancelAnimationFrame = id => {
      if (scheduled.has(id)) nativeCancel(scheduled.get(id));
      scheduled.delete(id); pending.delete(id);
    };
  }
  own('__SCREEN_GARDEN_SET_PAUSED', next => {
    if (!desktop) return;
    if (typeof next === 'boolean') next = {paused: next, pauseReason: next ? 'manual' : 'none'};
    if (!next || typeof next.paused !== 'boolean' ||
        !['none','manual','occluded','system'].includes(next.pauseReason) ||
        next.paused !== (next.pauseReason !== 'none')) return;
    if (state.paused === next.paused && state.pauseReason === next.pauseReason) return;
    state = Object.freeze({paused: next.paused, pauseReason: next.pauseReason});
    if (state.paused) {
      for (const handle of scheduled.values()) nativeCancel(handle);
      scheduled.clear();
    }
    attributes();
    window.dispatchEvent(new CustomEvent('wallpaperhost:statechange', {detail: state}));
    if (!state.paused) for (const id of pending.keys()) schedule(id);
  });
  function desktopTarget(u, v) {
    if (!desktop || !Number.isFinite(u) || !Number.isFinite(v) ||
        u < 0 || u >= 1 || v < 0 || v >= 1 || document.readyState === 'loading') return null;
    const x = Math.floor(u * innerWidth), y = Math.floor(v * innerHeight);
    const target = document.elementFromPoint(x, y);
    return target ? {x, y, target} : null;
  }
  own('__SCREEN_GARDEN_DESKTOP_MOVE', (u, v) => {
    const point = desktopTarget(u, v);
    if (!point) return {delivered: false};
    point.target.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, composed: true, view: window, clientX: point.x, clientY: point.y,
      buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true
    }));
    return {delivered: true};
  });
  own('__SCREEN_GARDEN_DESKTOP_CLICK', (u, v) => {
    const point = desktopTarget(u, v);
    if (!point) return {delivered: false};
    const {x, y, target} = point;
    const options = {bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, button: 0, detail: 1};
    try {
      target.dispatchEvent(new PointerEvent('pointerdown', {...options,
        buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true}));
      target.dispatchEvent(new MouseEvent('mousedown', {...options, buttons: 1}));
      target.dispatchEvent(new PointerEvent('pointerup', {...options,
        buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true}));
      target.dispatchEvent(new MouseEvent('mouseup', {...options, buttons: 0}));
      if (!target.isConnected) return {delivered: false};
      target.dispatchEvent(new MouseEvent('click', {...options, buttons: 0}));
      return {delivered: true, x, y};
    } catch { return {delivered: false}; }
  });
  function json(value) {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > 8192) {
      throw new Error('Invalid JSON size');
    }
    return JSON.parse(serialized);
  }
  const idValid = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id);
  const tokenValid = id => typeof id === 'string' && id.length > 0 && id.length <= 128;
  const textValid = (value, max) => typeof value === 'string' &&
    value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  function provider() {
    const app = window.wallpaperApp;
    return app?.protocolVersion === 1 && typeof app.getActions === 'function' &&
      typeof app.invoke === 'function' ? app : null;
  }
  function readActions() {
    const app = provider();
    if (!capabilities.actions || !app) return [];
    if (Object.prototype.toString.call(app.getActions) === '[object AsyncFunction]') throw new Error('Async descriptors');
    const raw = app.getActions();
    if (raw && typeof raw.then === 'function') {
      Promise.resolve(raw).catch(() => {});
      throw new Error('Async descriptors');
    }
    if (!Array.isArray(raw) || raw.length > 16) throw new Error('Invalid actions');
    json(raw);
    const ids = new Set();
    return raw.map(action => {
      if (!action || !idValid(action.id) || ids.has(action.id) ||
          !textValid(action.label, 32) || typeof action.enabled !== 'boolean' ||
          (action.disabledReason !== undefined && !textValid(action.disabledReason, 120)) ||
          (action.allowWhenOccluded !== undefined && typeof action.allowWhenOccluded !== 'boolean')) {
        throw new Error('Invalid descriptor');
      }
      ids.add(action.id);
      return {id: action.id, label: action.label, enabled: action.enabled,
        ...(action.disabledReason !== undefined ? {disabledReason: action.disabledReason} : {}),
        allowWhenOccluded: action.allowWhenOccluded === true};
    });
  }
  own('__SCREEN_GARDEN_GET_ACTIONS', () => {
    try { return {instanceId, actions: json(readActions())}; }
    catch { return {instanceId, actions: [], error: '暂时无法读取这张壁纸的操作。'}; }
  });
  function failure(requestId, code, message) { return {ok: false, requestId, code, message}; }
  function execute(request) {
    const requestId = typeof request?.requestId === 'string' ? request.requestId : '';
    if (!request || request.protocolVersion !== 1 || !tokenValid(requestId) ||
        !tokenValid(request.instanceId) || !idValid(request.actionId)) {
      return failure(requestId, 'INVALID_REQUEST', '壁纸操作请求无效。');
    }
    if (request.instanceId !== instanceId) return failure(requestId, 'STALE_INSTANCE', '壁纸已经切换或重新加载。');
    const old = replies.get(requestId);
    if (old) return old.actionId === request.actionId ? JSON.parse(old.result) :
      failure(requestId, 'INVALID_REQUEST', '重复请求的内容不一致。');
    let result;
    try {
      const app = provider();
      if (!capabilities.actions) result = failure(requestId, 'UNSUPPORTED', '当前环境没有主程序操作能力。');
      else if (document.readyState === 'loading') result = failure(requestId, 'NOT_READY', '壁纸正在载入，请稍后再试。');
      else if (!app) result = failure(requestId, 'UNSUPPORTED', '这张壁纸没有提供主程序操作。');
      else {
        const action = readActions().find(action => action.id === request.actionId);
        if (!action) result = failure(requestId, 'UNKNOWN_ACTION', '这张壁纸没有这个操作。');
        else if (state.paused && (state.pauseReason !== 'occluded' || !action.allowWhenOccluded)) {
          result = failure(requestId, 'PAUSED', '壁纸已暂停，请先继续播放。');
        } else if (!action.enabled) result = failure(requestId, 'DISABLED', action.disabledReason || '这个操作暂时不可用。');
        else if (Object.prototype.toString.call(app.invoke) === '[object AsyncFunction]') {
          result = failure(requestId, 'UNSUPPORTED', '当前操作不支持同步调用。');
        } else {
          const reply = app.invoke(json(request));
          if (reply && typeof reply.then === 'function') {
            Promise.resolve(reply).catch(() => {});
            throw new Error('Async result');
          }
          result = json(reply);
          if (!result || typeof result !== 'object' || Array.isArray(result) ||
              typeof result.ok !== 'boolean' || result.requestId !== requestId ||
              (!result.ok && (!['NOT_READY','UNSUPPORTED','UNKNOWN_ACTION','DISABLED','PAUSED',
                'INVALID_REQUEST','STALE_INSTANCE','BUSY','FAILED','RESULT_UNKNOWN'].includes(result.code) ||
                !textValid(result.message, 512)))) throw new Error('Invalid result');
          result = result.ok ? {ok: true, requestId, ...(result.data !== undefined ? {data: result.data} : {})} :
            {ok: false, requestId, code: result.code, message: result.message};
        }
      }
    } catch {
      result = failure(requestId, 'RESULT_UNKNOWN', '未能确认操作结果，请先查看壁纸，避免重复操作。');
    }
    const serialized = JSON.stringify(result);
    replies.set(requestId, {actionId: request.actionId, result: serialized});
    if (replies.size > 128) replies.delete(replies.keys().next().value);
    return JSON.parse(serialized);
  }
  own('__SCREEN_GARDEN_INVOKE_ACTION', request => ({instanceId, result: execute(request)}));
})

(() => {
  'use strict';
  const normalize = value => /^zh(?:-|$)/i.test(value || '') ? 'zh-CN' : 'en';
  let locale = normalize(window.wallpaperHost?.getState().locale || navigator.language);
  function t(key, values = {}) {
    const template = locale === 'en' ? (window.wallpaperEnglish[key] ?? key) : key;
    return String(template ?? '').replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match);
  }
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const templates = Object.keys(window.wallpaperEnglish).filter(key => /\{\w+\}/.test(key)).map(key => {
    const names = [];
    const pattern = key.split(/(\{\w+\})/).map(part => {
      if (!/^\{\w+\}$/.test(part)) return escape(part);
      names.push(part.slice(1, -1));
      return '([\\s\\S]*?)';
    }).join('');
    return {key, names, pattern: new RegExp('^' + pattern + '$')};
  });
  // Native errors may include a path, version or nested service error. Only
  // translate declared messages; retain external details as supplied.
  function message(value, depth = 0) {
    const source = String(value ?? '');
    if (locale !== 'en' || !source || depth > 4) return source;
    if (Object.hasOwn(window.wallpaperEnglish, source)) return t(source);
    for (const {key, names, pattern} of templates) {
      const match = source.match(pattern);
      if (match) return t(key, Object.fromEntries(names.map((name, index) =>
        [name, message(match[index + 1], depth + 1)])));
    }
    return source.split(/([：；\n])/).map(part =>
      ({'：': ': ', '；': '; '}[part] ?? window.wallpaperEnglish[part] ?? part)).join('');
  }
  function apply() {
    document.documentElement.lang = locale;
    for (const node of document.querySelectorAll('[data-i18n]')) {
      node.textContent = t(node.dataset.i18n);
    }
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      for (const node of document.querySelectorAll('[data-i18n-' + attr + ']')) {
        node.setAttribute(attr, t(node.getAttribute('data-i18n-' + attr)));
      }
    }
  }
  function setLocale(value) {
    const next = normalize(value);
    if (next === locale) return false;
    locale = next;
    apply();
    window.dispatchEvent(new CustomEvent('app:localechange', {detail: {locale}}));
    return true;
  }
  window.wallpaperI18n = Object.freeze({t, message, normalize, apply, setLocale, get locale() {return locale;}});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, {once: true});
  else apply();
})();

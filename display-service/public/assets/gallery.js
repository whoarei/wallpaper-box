(() => {
  'use strict';
  const list = document.getElementById('scenes');
  const notice = document.getElementById('notice');
  const count = document.getElementById('count');
  let lastSignature = '', busy = false;
  const cards = new Map();
  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function card(module) {
    const article = element('article', 'scene');
    article.dataset.module = module.id;
    const preview = element('a', 'preview');
    preview.href = module.href;
    preview.setAttribute('aria-label', '进入' + module.name);
    const fallback = element('div', 'fallback');
    fallback.append(element('span', 'fallback-symbol', Array.from(module.name)[0] || '景'), element('small', '', 'A LITTLE WORLD'));
    preview.append(fallback);
    if (module.cover) {
      const img = element('img');
      img.alt = module.name + '封面'; img.loading = 'lazy'; img.decoding = 'async'; img.src = module.cover;
      fallback.hidden = true;
      img.addEventListener('error', () => { img.remove(); fallback.hidden = false; });
      preview.append(img);
    }
    preview.append(element('span', 'badge', '随时进入'), element('span', 'arrow', '↗'));
    const info = element('div', 'scene-info'), copy = element('div');
    const title = element('h2', 'scene-title', module.name);
    if (module.subtitle) title.append(element('span', 'en', module.subtitle));
    copy.append(title);
    if (module.description) copy.append(element('p', 'description', module.description));
    if (module.tags.length) copy.append(element('p', 'tags', module.tags.join(' · ')));
    const enter = element('a', 'enter', '进入风景');
    enter.href = module.href; enter.append(element('span', '', '↗'));
    info.append(copy, enter); article.append(preview, info);
    return article;
  }
  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const response = await fetch('/api/modules', {cache: 'no-store', signal: AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error('Catalog unavailable');
      const data = await response.json();
      if (!Array.isArray(data.modules)) throw new Error('Invalid catalog');
      const signature = JSON.stringify(data.modules);
      if (signature !== lastSignature) {
        const current = new Set(data.modules.map(module => module.id));
        for (const [id, saved] of cards) if (!current.has(id)) { saved.node.remove(); cards.delete(id); }
        for (const module of data.modules) {
          const revision = JSON.stringify(module);
          let saved = cards.get(module.id);
          if (!saved || saved.revision !== revision) {
            const node = card(module);
            if (saved) saved.node.replaceWith(node);
            saved = {node, revision}; cards.set(module.id, saved);
          }
          list.append(saved.node);
        }
        list.classList.toggle('single', data.modules.length === 1);
        count.textContent = `${String(data.modules.length).padStart(2, '0')} / ${data.modules.length} 处风景`;
        lastSignature = signature;
      }
      notice.textContent = data.modules.length ? '' : '这里还没有风景，先留一点空白。';
      notice.hidden = data.modules.length > 0;
    } catch (error) {
      notice.textContent = cards.size ? '风景列表暂时无法更新，已加载的风景仍可进入。' : '风景暂时没有加载出来，正在等它回来。';
      notice.hidden = false;
    } finally { busy = false; }
  }
  refresh();
  setInterval(refresh, 5000);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();

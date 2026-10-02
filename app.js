(() => {
'use strict';

/* =========================================================
   Where the site lives on GitHub — owner mode saves here
   ========================================================= */
const GH = { owner: 'juanjuarezarc', repo: 'JuanJuarezArc.github.io', branch: 'main' };

/* =========================================================
   Basics
   ========================================================= */
const COLS = 12;                       // grid columns on desktop
const STACK_BELOW = 640;               // px — below this the grid becomes one column
const MEDIA_TYPES = 'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let C = null;            // site content
let owner = false;       // logged in?
let editing = false;
let dirty = false;
let saving = false;

const route = (() => {
  const q = new URLSearchParams(location.search);
  if (q.get('p')) return { type: 'project', slug: q.get('p') };
  return { type: 'home', admin: q.has('admin') || location.hash === '#admin' };
})();

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.'); const last = ks.pop();
  const t = ks.reduce((a, k) => (a[k] = a[k] || {}), o);
  t[last] = v;
}

/* Keep only simple formatting in rich text (bold, italic, links, paragraphs, lists). */
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI']);
function clean(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstChild;
  (function walk(n) {
    for (const c of [...n.children]) {
      walk(c);
      if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|svg|math)$/i.test(c.tagName)) { c.remove(); continue; }
      if (!ALLOWED.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
      for (const a of [...c.attributes]) if (!(c.tagName === 'A' && a.name === 'href')) c.removeAttribute(a.name);
      if (c.tagName === 'A') {
        const h = c.getAttribute('href') || '';
        if (!/^(https?:|mailto:|\/)/i.test(h)) c.removeAttribute('href');
        else if (/^https?:/i.test(h)) { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); }
      }
    }
  })(root);
  return root.innerHTML;
}

function linkHref(link) {
  if (!link) return null;
  if (link.startsWith('p:')) return '/?p=' + encodeURIComponent(link.slice(2));
  if (/^(https?:\/\/|mailto:)/i.test(link)) return link;
  return null;
}
const safeSrc = s => (/^\/uploads\/[\w.-]+$/.test(s || '') || /^https:\/\//.test(s || '') ? s : '');
const isVideo = s => /\.(mp4|webm)(\?|$)/i.test(s || '');

/* =========================================================
   Boot
   ========================================================= */
async function boot() {
  try {
    token = tokenStore.get();
    if (token) {
      // owner: load the newest content straight from GitHub (Pages can lag ~1 min)
      try {
        if (await ghCanWrite()) { C = await ghLoad(); owner = true; }
        else { tokenStore.set(null); token = null; }
      } catch { /* offline or rate-limited — fall back to the public copy */ }
    }
    if (!C) C = await fetch('/content.json?v=' + Date.now(), { cache: 'no-store' }).then(r => { if (!r.ok) throw r; return r.json(); });
  } catch (e) {
    $('#view').innerHTML = '<section class="zone narrow"><h2>Offline</h2><p class="lede">The site could not load its content.</p></section>';
    document.body.classList.add('ready');
    return;
  }
  for (const k of ['site', 'home', 'projects', 'boards']) C[k] = C[k] || {};

  render();
  document.body.classList.add('ready');

  if (location.hash) {
    const t = document.getElementById(location.hash.slice(1));
    if (t) requestAnimationFrame(() => t.scrollIntoView());
  }
  if (owner) { showDock(); }
  if (route.admin) {
    history.replaceState(null, '', '/');
    if (owner) setEditing(true); else login();
  }
}

/* =========================================================
   Rendering
   ========================================================= */
function render() {
  const proj = route.type === 'project' ? C.projects[route.slug] : null;
  document.title = proj ? `${proj.title} — ${C.site.name || ''}` : (C.site.title || C.site.name || 'Portfolio');
  if (proj) syncProjectCaption.prev[route.slug] = proj.title;
  $('#view').innerHTML = route.type === 'project' ? projectHTML(route.slug) : homeHTML();
  bindText(document);
  renderNav();
  $$('#view .board').forEach(b => renderBoard(b));
  observeReveals();
  if (editing) setEditing(true);
}

function homeHTML() {
  return `
  <section class="hero" id="top">
    <div class="hero-stick">
      <div class="hero-inner">
        <h1 class="display" data-edit="home.heroTitle"></h1>
        <p class="lede" data-edit="home.heroSub"></p>
      </div>
      <div class="cue" aria-hidden="true"></div>
    </div>
  </section>

  <section class="zone" id="work">
    <header class="zone-head reveal">
      <h2 data-edit="home.workTitle"></h2>
      <p data-edit="home.workSub"></p>
    </header>
    <div class="board dim" data-board="work"></div>
  </section>

  <section class="zone narrow" id="about">
    <h2 class="reveal" data-edit="home.aboutTitle"></h2>
    <div class="prose reveal" data-edit="home.aboutText" data-rich></div>
  </section>

  <section class="zone narrow" id="contact">
    <h2 class="reveal" data-edit="home.contactTitle"></h2>
    <div class="prose reveal" data-edit="home.contactText" data-rich></div>
    <a class="mail reveal" data-edit="site.email" data-mail></a>
  </section>`;
}

function projectHTML(slug) {
  const p = C.projects[slug];
  if (!p) return `<section class="project-head"><h1 class="display">Not found</h1><p class="lede"><a href="/#work">Back to work</a></p></section>`;
  const next = nextProject(slug);
  const s = esc(slug);
  return `
  <section class="project-head">
    <a class="back reveal" href="/#work">← Work</a>
    <h1 class="display reveal" data-edit="projects.${s}.title"></h1>
    <p class="lede reveal" data-edit="projects.${s}.sub"></p>
  </section>
  <section class="zone tight">
    <div class="board" data-board="${s}"></div>
  </section>
  ${next ? `<a class="next reveal" href="/?p=${encodeURIComponent(next)}"><span>Next project</span><strong>${esc(C.projects[next].title)}</strong></a>` : ''}`;
}

/* Projects in the order they appear on the Work grid */
function projectOrder() {
  const items = ((C.boards.work || {}).items || []).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const seen = [];
  for (const it of items) {
    const s = it.link && it.link.startsWith('p:') ? it.link.slice(2) : null;
    if (s && C.projects[s] && !seen.includes(s)) seen.push(s);
  }
  for (const s of Object.keys(C.projects)) if (!seen.includes(s)) seen.push(s);
  return seen;
}
function nextProject(slug) {
  const o = projectOrder();
  if (o.length < 2) return null;
  return o[(o.indexOf(slug) + 1) % o.length];
}

function bindText(root) {
  $$('[data-edit]', root).forEach(el => {
    const v = getPath(C, el.dataset.edit) ?? '';
    if ('rich' in el.dataset) el.innerHTML = clean(v); else el.textContent = v;
    if ('mail' in el.dataset) el.href = v ? 'mailto:' + v : '#';
    el.classList.toggle('is-empty', !String(v).replace(/<[^>]*>/g, '').trim());
    if (!el.dataset.placeholder) el.dataset.placeholder = 'Click to write…';
  });
}

function renderNav() {
  const a = $('#resumeLink');
  a.hidden = !C.site.resume;
  a.href = C.site.resume || '#';
}

/* ---------- reveal on scroll ---------- */
const io = new IntersectionObserver(entries => {
  for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
function observeReveals(root = document) { $$('.reveal:not(.in)', root).forEach(el => io.observe(el)); }

/* ---------- hero scale-out + frosted nav ---------- */
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    $('#nav').classList.toggle('scrolled', scrollY > 8);
    const cue = $('.cue');
    if (cue) cue.classList.toggle('gone', scrollY > 20);
    const hero = $('.hero'), inner = $('.hero-inner');
    if (!hero || !inner || reduceMotion) return;
    const r = hero.getBoundingClientRect();
    const p = clamp(-r.top / Math.max(1, r.height - innerHeight), 0, 1);
    inner.style.transform = `scale(${1 - p * 0.14}) translateY(${-p * 40}px)`;
    inner.style.opacity = String(clamp(1 - p * 1.15, 0, 1));
    inner.style.filter = p > 0.01 ? `blur(${p * 10}px)` : '';
  });
}
addEventListener('scroll', onScroll, { passive: true });

/* =========================================================
   Grid board
   ========================================================= */
const boardOf = el => (C.boards[el.dataset.board] = C.boards[el.dataset.board] || { items: [] });
const findItem = (boardEl, id) => boardOf(boardEl).items.find(i => i.id === id);
const bottomOf = b => b.items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
const mainBoard = () => $('#view .board');

function renderBoard(boardEl, instant = false) {
  const b = boardOf(boardEl);
  const sel = $('.item.sel', boardEl)?.dataset.id;
  boardEl.innerHTML = '<div class="snap" hidden></div>';
  b.items.forEach((it, i) => {
    const el = itemEl(it, i);
    if (instant) el.querySelector('.inner').classList.add('in', 'now');
    el.classList.add('fresh');           // first placement shouldn't animate from the corner
    boardEl.appendChild(el);
  });
  if (!boardEl._bound) bindBoard(boardEl);
  layoutBoard(boardEl);
  void boardEl.offsetHeight;
  $$('.item.fresh', boardEl).forEach(el => el.classList.remove('fresh'));
  if (sel) $(`.item[data-id="${sel}"]`, boardEl)?.classList.add('sel');
  if (!instant) observeReveals(boardEl);
}

function itemEl(it, i) {
  const el = document.createElement('div');
  el.className = `item ${it.type === 'text' ? 'text' : 'media'}`;
  el.dataset.id = it.id;

  const href = linkHref(it.link);
  const inner = document.createElement(href ? 'a' : 'div');
  inner.className = 'inner reveal';
  inner.style.transitionDelay = reduceMotion ? '0s' : `${Math.min(i, 8) * 70}ms`;
  inner.addEventListener('transitionend', () => { inner.style.transitionDelay = '0s'; }, { once: true });
  if (href) {
    inner.href = href;
    if (/^https?:/i.test(href)) { inner.target = '_blank'; inner.rel = 'noopener'; }
  }

  if (it.type === 'text') {
    const t = document.createElement('div');
    t.className = `txt size-${it.size || 'm'}`;
    t.innerHTML = clean(it.html);
    inner.appendChild(t);
  } else {
    const src = safeSrc(it.src);
    if (src) {
      const m = document.createElement(isVideo(src) ? 'video' : 'img');
      if (m.tagName === 'VIDEO') {
        m.muted = true; m.loop = true; m.autoplay = true; m.playsInline = true;
        m.setAttribute('muted', ''); m.setAttribute('playsinline', '');
      } else {
        m.loading = 'lazy'; m.decoding = 'async'; m.alt = it.caption || '';
      }
      m.draggable = false;
      if (it.fit === 'contain') m.classList.add('contain');
      // Fresh uploads take ~1 min to appear on GitHub Pages: show the local copy, or GitHub's raw file meanwhile
      if (owner && src.startsWith('/uploads/')) {
        m.addEventListener('error', () => { if (!m.dataset.raw) { m.dataset.raw = '1'; m.src = rawUrl(src); } });
      }
      m.src = localPreview.get(src) || src;
      inner.appendChild(m);
    } else {
      inner.classList.add('ph');
    }
    if (it.caption) {
      const c = document.createElement('span');
      c.className = 'cap';
      c.textContent = it.caption;
      inner.appendChild(c);
    }
  }
  el.appendChild(inner);
  if (owner) el.insertAdjacentHTML('beforeend', toolsHTML(it));
  return el;
}

function metrics(boardEl) {
  const gap = parseFloat(getComputedStyle(boardEl).getPropertyValue('--gap')) || 16;
  const W = boardEl.clientWidth;
  return { gap, W, cell: (W + gap) / COLS };
}

function place(el, it, m) {
  el.style.transform = `translate(${it.x * m.cell}px, ${it.y * m.cell}px)`;
  el.style.width = `${it.w * m.cell - m.gap}px`;
  el.style.height = `${it.h * m.cell - m.gap}px`;
  el.style.zIndex = it.z || '';
}

function sizeBoard(boardEl, m) {
  const rows = bottomOf(boardOf(boardEl)) + (editing ? 3 : 0);
  boardEl.style.height = `${Math.max(rows * m.cell - m.gap, 0)}px`;
}

function layoutBoard(boardEl) {
  const b = boardOf(boardEl);
  const stack = boardEl.clientWidth < STACK_BELOW;
  boardEl.classList.toggle('stack', stack);
  const m = metrics(boardEl);
  boardEl.style.setProperty('--cell', `${m.cell}px`);
  for (const el of $$('.item', boardEl)) {
    const it = b.items.find(x => x.id === el.dataset.id);
    if (!it) continue;
    if (stack) {
      el.style.cssText = '';
      el.style.order = String(it.y * COLS + it.x);
      if (it.type !== 'text') el.style.aspectRatio = String(it.w / it.h);
    } else {
      el.style.order = ''; el.style.aspectRatio = '';
      place(el, it, m);
    }
  }
  if (stack) boardEl.style.height = ''; else sizeBoard(boardEl, m);
}

function bindBoard(boardEl) {
  boardEl._bound = true;
  let lastW = 0;
  new ResizeObserver(() => {
    if (boardEl.clientWidth !== lastW) { lastW = boardEl.clientWidth; layoutBoard(boardEl); }
  }).observe(boardEl);
  boardEl.addEventListener('pointerdown', e => onBoardPointer(e, boardEl));
  boardEl.addEventListener('dblclick', e => {
    const el = editing && e.target.closest('.item.text');
    if (el) editText(el, boardEl);
  });
  boardEl.addEventListener('click', e => onTool(e, boardEl));
  bindDrop(boardEl);
}

/* =========================================================
   Owner mode — dragging, resizing, tools
   ========================================================= */
function toolsHTML(it) {
  const b = (act, label, title) => `<button type="button" data-act="${act}" title="${title || label}">${label}</button>`;
  return `<div class="tools">${
    it.type === 'text'
      ? b('size', 'Aa', 'Text size') + b('edit', 'Edit', 'Edit text')
      : b('replace', 'Replace', 'Replace image or video') + b('fit', 'Fit', 'Fill frame / show whole image') + b('caption', 'Caption')
  }${b('link', 'Link', 'Link to a project or website')}${
    it.link && it.link.startsWith('p:') ? b('open', 'Open ↗', 'Open the linked project page') : ''
  }${b('front', '↑', 'Bring to front')}${b('dup', '⧉', 'Duplicate')}${b('del', '✕', 'Delete')}</div><div class="handle" title="Drag to resize"></div>`;
}

function select(el) {
  $$('.item.sel').forEach(x => x !== el && x.classList.remove('sel'));
  if (el) el.classList.add('sel');
}

function onBoardPointer(e, boardEl) {
  if (!editing || e.button !== 0) return;
  const el = e.target.closest('.item');
  if (!el) { select(null); return; }
  if (e.target.closest('.tools') || e.target.isContentEditable) return;
  select(el);
  if (boardEl.classList.contains('stack')) return;
  drag(e, boardEl, el, findItem(boardEl, el.dataset.id), e.target.closest('.handle') ? 'resize' : 'move');
}

function drag(e, boardEl, el, it, mode) {
  e.preventDefault();
  const m = metrics(boardEl);
  const snap = $('.snap', boardEl);
  const sx = e.pageX, sy = e.pageY;
  const o = { x: it.x, y: it.y, w: it.w, h: it.h };
  let moved = false;

  const onMove = ev => {
    const dx = ev.pageX - sx, dy = ev.pageY - sy;
    if (!moved) {
      if (Math.hypot(dx, dy) < 4) return;
      moved = true;
      el.classList.add('dragging');
      snap.hidden = false;
    }
    if (mode === 'move') {
      it.x = clamp(Math.round(o.x + dx / m.cell), 0, COLS - it.w);
      it.y = Math.max(0, Math.round(o.y + dy / m.cell));
      el.style.transform = `translate(${o.x * m.cell + dx}px, ${o.y * m.cell + dy}px)`;
    } else {
      it.w = clamp(Math.round(o.w + dx / m.cell), 1, COLS - it.x);
      it.h = Math.max(1, Math.round(o.h + dy / m.cell));
      el.style.width = `${Math.max(m.cell - m.gap, o.w * m.cell - m.gap + dx)}px`;
      el.style.height = `${Math.max(m.cell - m.gap, o.h * m.cell - m.gap + dy)}px`;
    }
    place(snap, it, m);
    sizeBoard(boardEl, m);
    // gentle auto-scroll near the window edges
    if (ev.clientY > innerHeight - 70) scrollBy(0, 14);
    else if (ev.clientY < 70) scrollBy(0, -14);
  };
  const onUp = () => {
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onUp);
    if (!moved) return;
    el.classList.remove('dragging');
    snap.hidden = true;
    place(el, it, m);
    sizeBoard(boardEl, m);
    if (o.x !== it.x || o.y !== it.y || o.w !== it.w || o.h !== it.h) markDirty();
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
}

async function onTool(e, boardEl) {
  const btn = e.target.closest('[data-act]');
  if (!btn || !editing) return;
  e.preventDefault(); e.stopPropagation();
  const el = btn.closest('.item');
  const b = boardOf(boardEl);
  const it = b.items.find(i => i.id === el.dataset.id);
  if (!it) return;

  switch (btn.dataset.act) {
    case 'replace': {
      const [f] = await pickFiles(false);
      if (!f) return;
      const up = await upload(f);
      if (!up) return;
      it.src = up.url;
      break;
    }
    case 'fit': it.fit = it.fit === 'contain' ? 'cover' : 'contain'; break;
    case 'caption': {
      const v = await ask('Caption', it.caption || '', 'text', 'Shown when hovering the image. Leave empty for none.');
      if (v === null) return;
      it.caption = v.trim();
      break;
    }
    case 'size': {
      const order = ['s', 'm', 'l', 'xl'];
      it.size = order[(order.indexOf(it.size || 'm') + 1) % order.length];
      toast({ s: 'Small', m: 'Body', l: 'Large', xl: 'Headline' }[it.size]);
      break;
    }
    case 'edit': editText(el, boardEl); return;
    case 'link': {
      const v = await chooseLink(it.link);
      if (v === undefined) return;
      it.link = v;
      break;
    }
    case 'open': {
      const href = linkHref(it.link);
      if (href) { if (dirty) await save(); if (!dirty) go(href); }
      return;
    }
    case 'front': it.z = b.items.reduce((m, i) => Math.max(m, i.z || 0), 0) + 1; break;
    case 'dup': {
      const copy = JSON.parse(JSON.stringify(it));
      copy.id = uid(); copy.y = bottomOf(b);
      b.items.push(copy);
      markDirty(); renderBoard(boardEl, true);
      select($(`.item[data-id="${copy.id}"]`, boardEl));
      return;
    }
    case 'del':
      if (!await confirmBox('Delete this block?', 'Delete')) return;
      b.items = b.items.filter(i => i !== it);
      break;
  }
  markDirty();
  renderBoard(boardEl, true);
}

async function chooseLink(cur) {
  const opts = [{ v: '', l: 'No link' }]
    .concat(projectOrder().map(s => ({ v: 'p:' + s, l: 'Project · ' + (C.projects[s].title || s) })))
    .concat([{ v: 'url', l: 'Website / external link…' }]);
  const v = await choose('Link this block to', opts, cur || '');
  if (v === null) return undefined;
  if (v === 'url') {
    const u = await ask('Website address', /^https?:/.test(cur || '') ? cur : 'https://');
    if (u === null) return undefined;
    if (!/^https?:\/\/\S+$/i.test(u.trim())) { toast('Use a full address starting with https://'); return undefined; }
    return u.trim();
  }
  return v || null;
}

/* ---------- text blocks ---------- */
let activeText = null;
function editText(el, boardEl) {
  if (activeText && activeText.el === el) return;
  finishText();
  const t = $('.txt', el);
  t.contentEditable = 'true';
  el.classList.add('typing');
  activeText = { el, t, boardEl, id: el.dataset.id };
  t.focus();
  const r = document.createRange(); r.selectNodeContents(t); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
function finishText() {
  if (!activeText) return;
  const { t, el, boardEl, id } = activeText;
  activeText = null;
  t.removeAttribute('contenteditable');
  el.classList.remove('typing');
  const it = findItem(boardEl, id);
  if (it) { const html = clean(t.innerHTML); if (html !== it.html) { it.html = html; markDirty(); } }
  hideFmt();
}
document.addEventListener('pointerdown', e => {
  if (activeText && !activeText.el.contains(e.target) && !e.target.closest('.fmt, .modal')) finishText();
}, true);

/* ---------- drag files from your computer onto the grid ---------- */
function bindDrop(boardEl) {
  boardEl.addEventListener('dragover', e => {
    if (!editing || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    boardEl.classList.add('drop');
  });
  boardEl.addEventListener('dragleave', e => { if (!boardEl.contains(e.relatedTarget)) boardEl.classList.remove('drop'); });
  boardEl.addEventListener('drop', async e => {
    if (!editing) return;
    e.preventDefault();
    boardEl.classList.remove('drop');
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    const target = e.target.closest('.item.media');
    if (target && files.length === 1) {                  // drop on an image = replace it
      const it = findItem(boardEl, target.dataset.id);
      const up = await upload(files[0]);
      if (up) { it.src = up.url; markDirty(); renderBoard(boardEl, true); }
      return;
    }
    const m = metrics(boardEl), r = boardEl.getBoundingClientRect();
    const x = clamp(Math.floor((e.clientX - r.left) / m.cell), 0, COLS - 4);
    const y = Math.max(0, Math.floor((e.clientY - r.top) / m.cell));
    await addMedia(boardEl, files, x, y);
  });
}
addEventListener('dragover', e => { if (editing) e.preventDefault(); });
addEventListener('drop', e => { if (editing) e.preventDefault(); });

function mediaSize(file) {
  return new Promise(res => {
    const url = URL.createObjectURL(file);
    const done = (w, h) => { URL.revokeObjectURL(url); res([w || 4, h || 3]); };
    if (file.type.startsWith('video')) {
      const v = document.createElement('video');
      v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight);
      v.onerror = () => done();
      v.src = url;
    } else {
      const i = new Image();
      i.onload = () => done(i.naturalWidth, i.naturalHeight);
      i.onerror = () => done();
      i.src = url;
    }
  });
}

async function addMedia(boardEl, files, x0 = 0, y0 = null) {
  const b = boardOf(boardEl);
  let y = y0 == null ? bottomOf(b) : y0, x = x0, rowH = 0;
  let last = null;
  for (const f of files) {
    const [nw, nh] = await mediaSize(f);
    const up = await upload(f);
    if (!up) continue;
    const w = 4, h = clamp(Math.round(w * nh / nw), 1, 12);
    if (x + w > COLS) { x = 0; y += rowH; rowH = 0; }
    last = { id: uid(), type: 'image', x, y, w, h, src: up.url, caption: '' };
    b.items.push(last);
    x += w; rowH = Math.max(rowH, h);
    markDirty();
    renderBoard(boardEl, true);
  }
  if (last) {
    const el = $(`.item[data-id="${last.id}"]`, boardEl);
    select(el);
    el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }
}

/* =========================================================
   Owner mode — page text, format bar, dock
   ========================================================= */
function setEditing(on) {
  if (!on) finishText();
  editing = on;
  document.body.classList.toggle('editing', on);
  $$('[data-edit]').forEach(el => {
    if (on) {
      try { el.contentEditable = 'rich' in el.dataset ? 'true' : 'plaintext-only'; }
      catch { el.contentEditable = 'true'; }
    } else el.removeAttribute('contenteditable');
  });
  if (!on) { select(null); hideFmt(); bindText(document); }
  $$('#view .board').forEach(layoutBoard);
  updateDock();
}

document.addEventListener('input', e => {
  if (!editing) return;
  const t = e.target;
  if (activeText && t === activeText.t) {
    const it = findItem(activeText.boardEl, activeText.id);
    if (it) { it.html = clean(t.innerHTML); markDirty(); }
    return;
  }
  const el = t.closest && t.closest('[data-edit]');
  if (!el) return;
  const key = el.dataset.edit;
  const v = 'rich' in el.dataset ? clean(el.innerHTML) : el.innerText.replace(/\n+$/, '');
  setPath(C, key, v);
  if ('mail' in el.dataset) el.href = 'mailto:' + v;
  el.classList.toggle('is-empty', !v.replace(/<[^>]*>/g, '').trim());
  $$(`[data-edit="${key}"]`).forEach(o => { if (o !== el) o.textContent = v; });
  if (key.endsWith('.title') && key.startsWith('projects.')) syncProjectCaption(key.split('.')[1], v);
  markDirty();
});

// Renaming a project also renames its tile on the Work grid (if the caption matched)
function syncProjectCaption(slug, title) {
  const wb = C.boards.work;
  if (!wb) return;
  const prev = syncProjectCaption.prev[slug];
  for (const it of wb.items) if (it.link === 'p:' + slug && (it.caption === prev || !it.caption)) it.caption = title;
  syncProjectCaption.prev[slug] = title;
}
syncProjectCaption.prev = {};

/* format bar (bold / italic / link) for rich text */
const fmt = document.createElement('div');
fmt.className = 'fmt'; fmt.hidden = true;
fmt.innerHTML = '<button data-cmd="bold"><b>B</b></button><button data-cmd="italic"><i>I</i></button><button data-cmd="link">Link</button><button data-cmd="unlink">Unlink</button>';
document.body.appendChild(fmt);
let fmtHost = null;
const hideFmt = () => { fmt.hidden = true; fmtHost = null; };
fmt.addEventListener('pointerdown', e => e.preventDefault());
fmt.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b || !fmtHost) return;
  const host = fmtHost;
  if (b.dataset.cmd === 'link') {
    const sel = getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    if (!range || range.collapsed) { toast('Select some text first'); return; }
    const url = await ask('Link to', 'https://', 'text', 'A website (https://…) or an email (mailto:you@…)');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)\S+$/i.test(url.trim())) { toast('Use a full https:// or mailto: link'); return; }
    host.focus();
    sel.removeAllRanges(); sel.addRange(range);
    document.execCommand('createLink', false, url.trim());
  } else {
    document.execCommand(b.dataset.cmd, false, null);
  }
  host.dispatchEvent(new Event('input', { bubbles: true }));
});
document.addEventListener('focusin', e => {
  const t = e.target;
  if (!editing || !t.isContentEditable || !(t.matches('[data-rich]') || t.matches('.txt'))) return;
  fmtHost = t;
  const r = t.getBoundingClientRect();
  fmt.style.left = `${r.left + scrollX}px`;
  fmt.style.top = `${r.top + scrollY - 46}px`;
  fmt.hidden = false;
});
document.addEventListener('focusout', e => {
  if (e.target !== fmtHost) return;
  setTimeout(() => { if (fmtHost && document.activeElement !== fmtHost && !$('.modal')) hideFmt(); }, 0);
});

/* dock */
function showDock() {
  if ($('#dock')) return;
  const d = document.createElement('div');
  d.id = 'dock'; d.className = 'dock';
  const proj = route.type === 'project' && C.projects[route.slug];
  d.innerHTML = `
    <span class="dot" title="Owner mode"></span>
    <button data-dock="mode"></button>
    <span class="sep edit-only"></span>
    <button class="edit-only" data-dock="image" title="Upload images or videos">+ Image</button>
    <button class="edit-only" data-dock="text">+ Text</button>
    ${proj
      ? '<button class="edit-only" data-dock="delproject">Delete project</button>'
      : '<button class="edit-only" data-dock="project">+ Project</button><button class="edit-only" data-dock="resume">Résumé</button>'}
    <span class="sep"></span>
    <button class="solid" data-dock="save"></button>
    <button data-dock="logout">Log out</button>`;
  d.addEventListener('click', onDock);
  document.body.appendChild(d);
  updateDock();
}

function updateDock() {
  const d = $('#dock');
  if (!d) return;
  d.querySelector('[data-dock=mode]').textContent = editing ? 'Preview' : 'Edit';
  const s = d.querySelector('[data-dock=save]');
  s.textContent = saving ? 'Saving…' : dirty ? 'Save' : 'Saved';
  s.disabled = !dirty || saving;
  d.classList.toggle('dirty', dirty);
}

async function onDock(e) {
  const btn = e.target.closest('[data-dock]');
  if (!btn) return;
  const boardEl = mainBoard();
  switch (btn.dataset.dock) {
    case 'mode': setEditing(!editing); break;
    case 'image': {
      if (!boardEl) return;
      const files = await pickFiles(true);
      if (files.length) await addMedia(boardEl, files);
      break;
    }
    case 'text': {
      if (!boardEl) return;
      const b = boardOf(boardEl);
      const it = { id: uid(), type: 'text', x: 0, y: bottomOf(b), w: 5, h: 2, size: 'm', html: '<p>New text</p>' };
      b.items.push(it);
      markDirty();
      renderBoard(boardEl, true);
      const el = $(`.item[data-id="${it.id}"]`, boardEl);
      select(el);
      el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      editText(el, boardEl);
      document.execCommand('selectAll', false, null);
      break;
    }
    case 'project': await addProject(); break;
    case 'resume': await editResume(); break;
    case 'delproject': await deleteProject(route.slug); break;
    case 'save': await save(); break;
    case 'logout':
      if (dirty && !await confirmBox('You have unsaved changes. Log out anyway?', 'Log out')) return;
      dirty = false;
      tokenStore.set(null);
      location.reload();
      break;
  }
}

async function addProject() {
  const title = await ask('New project', '', 'text', 'Give it a title — you can change it any time.');
  if (!title || !title.trim()) return;
  const base = title.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-') || 'project';
  let slug = base, n = 2;
  while (C.projects[slug]) slug = `${base}-${n++}`;
  C.projects[slug] = { title: title.trim(), sub: '' };
  C.boards[slug] = { items: [
    { id: uid(), type: 'text', x: 0, y: 0, w: 4, h: 3, size: 'm', html: '<p>Describe the project — the site, the question, the process and what you learned.</p>' },
    { id: uid(), type: 'image', x: 5, y: 0, w: 7, h: 5, caption: 'Image' },
  ] };
  const wb = C.boards.work = C.boards.work || { items: [] };
  const tile = { id: uid(), type: 'image', x: 0, y: bottomOf(wb), w: 4, h: 3, caption: title.trim(), link: 'p:' + slug };
  wb.items.push(tile);
  markDirty();
  const boardEl = $('.board[data-board="work"]');
  if (boardEl) {
    renderBoard(boardEl, true);
    const el = $(`.item[data-id="${tile.id}"]`, boardEl);
    select(el);
    el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  toast('Project added — drag it into place, then “Open ↗” to fill it in');
}

async function deleteProject(slug) {
  const p = C.projects[slug];
  if (!p) return;
  if (!await confirmBox(`Delete “${p.title}”? Its page and layout will be removed.`, 'Delete')) return;
  delete C.projects[slug];
  delete C.boards[slug];
  if (C.boards.work) C.boards.work.items = C.boards.work.items.filter(i => i.link !== 'p:' + slug);
  for (const b of Object.values(C.boards)) for (const i of b.items) if (i.link === 'p:' + slug) i.link = null;
  dirty = true;
  await save();
  if (!dirty) go('/#work');
}

async function editResume() {
  if (C.site.resume) {
    const v = await choose('Résumé', [
      { v: 'replace', l: 'Replace PDF' },
      { v: 'view', l: 'View current' },
      { v: 'remove', l: 'Remove from site' },
    ]);
    if (v === 'view') { open(C.site.resume, '_blank'); return; }
    if (v === 'remove') { C.site.resume = ''; renderNav(); markDirty(); return; }
    if (v !== 'replace') return;
  }
  const [f] = await pickFiles(false, 'application/pdf');
  if (!f) return;
  const up = await upload(f);
  if (!up) return;
  C.site.resume = up.url;
  renderNav();
  markDirty();
  toast('Résumé linked in the top menu');
}

/* =========================================================
   Saving, login, uploads — all through the GitHub API.
   Each save / upload is a commit; GitHub Pages republishes in ~1 minute.
   ========================================================= */
const TOKEN_KEY = 'portfolio-gh-token';
const tokenStore = {
  get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(v) { try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};
let token = null;
let contentSha = null;
const localPreview = new Map();   // '/uploads/x.jpg' -> blob: URL for this session
const rawUrl = src => `https://raw.githubusercontent.com/${GH.owner}/${GH.repo}/${GH.branch}${src}`;

const UPLOAD_TYPES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'application/pdf': '.pdf',
};
const MAX_UPLOAD = 25 * 1024 * 1024;

function gh(method, path, body) {
  return fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}${path}`, {
    method,
    cache: 'no-store',
    headers: Object.assign(
      { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
}

// One write at a time, so commits never race each other
let ghQueue = Promise.resolve();
const queued = fn => (ghQueue = ghQueue.then(fn, fn));

// A real write test: creating an (unused, invisible) blob needs Contents: write.
// Reading the repo's "permissions" isn't enough — it reports the account's rights, not the token's.
async function ghCanWrite() {
  const r = await gh('POST', '/git/blobs', { content: '', encoding: 'utf-8' });
  return r.ok;
}

// Turn a failed GitHub response into a plain-English message
async function ghProblem(r) {
  if (!r) return 'Could not reach GitHub — check your connection';
  if (r.status === 401) return 'Your GitHub token expired — log in again';
  if (r.status === 403 || r.status === 404) return 'Your token can’t write to this site — make one with Contents: Read and write, then log in again';
  if (r.status === 409 || r.status === 422) return 'The site changed somewhere else (another tab?). Copy your text, reload, and redo the change.';
  const j = await r.json().catch(() => ({}));
  return `GitHub refused the change (${r.status}${j.message ? ': ' + j.message : ''})`;
}

function relogin() {
  tokenStore.set(null);
  token = null;
  login();
}

const b64ToText = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
function textToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const blobToB64 = blob => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1] || '');
  fr.onerror = rej;
  fr.readAsDataURL(blob);
});

async function ghLoad() {
  const r = await gh('GET', `/contents/content.json?ref=${encodeURIComponent(GH.branch)}`);
  if (!r.ok) throw r;
  const j = await r.json();
  contentSha = j.sha;
  return JSON.parse(b64ToText(j.content));
}

function ghPut(path, b64, message, sha) {
  return gh('PUT', `/contents/${path}`, Object.assign({ message, content: b64, branch: GH.branch }, sha ? { sha } : {}));
}

function markDirty() { dirty = true; updateDock(); }

async function save() {
  if (saving || !dirty) return;
  finishText();
  saving = true; updateDock();
  let r = null;
  try {
    const body = textToB64(JSON.stringify(C, null, 1) + '\n');
    r = await queued(() => ghPut('content.json', body, 'Update site content', contentSha));
  } catch { /* offline */ }
  saving = false;
  if (r && r.ok) {
    contentSha = (await r.json()).content.sha;
    dirty = false;
    toast('Saved — live on your site in about a minute', 3500);
  } else {
    toast(await ghProblem(r), 8000);
    // Bad or expired token: ask for a new one. Your unsaved edits stay on the page — Save again after.
    if (r && [401, 403, 404].includes(r.status)) relogin();
  }
  updateDock();
}

async function login() {
  let title = 'Owner login';
  for (;;) {
    const t = await ask(title, '', 'password',
      'Paste your GitHub access token. It needs <b>Contents: Read and write</b> on ' +
      `<b>${esc(GH.repo)}</b>. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="text-decoration:underline">Create one</a>. ` +
      'It is kept only in this browser.');
    if (t === null) return;
    token = t.trim();
    let ok = false;
    try { ok = await ghCanWrite(); } catch { /* offline */ }
    if (ok) {
      tokenStore.set(token);
      try {
        const latest = await ghLoad();       // also refreshes the version id needed to save
        if (!dirty) C = latest;              // keep unsaved edits if re-logging in mid-edit
      } catch { toast('Could not load the latest content from GitHub', 4000); }
      owner = true;
      render();            // re-render so blocks get their edit tools
      showDock();
      setEditing(true);
      toast(dirty ? 'Logged in — press Save to publish your changes' : 'Owner mode — edit anything, then Save', 4000);
      return;
    }
    token = null;
    title = 'That token can’t write to this site. Check it has Contents: Read and write on this repository.';
  }
}

// Large photos are scaled down before upload (long side 2800px) to keep the site fast
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return file;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const MAX = 2800;
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 2.5e6) { if (bmp.close) bmp.close(); return file; }
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * scale);
  cv.height = Math.round(bmp.height * scale);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  if (bmp.close) bmp.close();
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const blob = await new Promise(r => cv.toBlob(r, type, 0.86));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + (type === 'image/jpeg' ? '.jpg' : '.webp'), { type });
}

async function upload(file) {
  if (!UPLOAD_TYPES[file.type]) {
    toast('Use JPG, PNG, WebP, GIF, AVIF, MP4, WebM or PDF (iPhone HEIC photos: export as JPG first)', 6000);
    return null;
  }
  toast(`Uploading ${file.name}…`, 120000);
  file = await shrink(file);
  if (file.size > MAX_UPLOAD) { toast('That file is over 25 MB — compress it first (videos especially)', 6000); return null; }
  const name = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + uid() + UPLOAD_TYPES[file.type];
  let r = null;
  try {
    const b64 = await blobToB64(file);
    r = await queued(() => ghPut('uploads/' + name, b64, `Upload ${file.name}`));
  } catch { /* offline */ }
  if (!r || !r.ok) {
    toast(await ghProblem(r), 8000);
    if (r && [401, 403, 404].includes(r.status)) relogin();
    return null;
  }
  const url = '/uploads/' + name;
  localPreview.set(url, URL.createObjectURL(file));
  toast('Uploaded — remember to Save');
  return { url };
}

function pickFiles(multiple, accept = MEDIA_TYPES) {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.onchange = () => res([...i.files]);
    i.addEventListener('cancel', () => res([]));
    i.click();
  });
}

/* =========================================================
   Navigation + page transitions
   ========================================================= */
function go(href) {
  document.body.classList.add('leaving');
  setTimeout(() => { location.href = href; }, reduceMotion ? 0 : 450);
}
addEventListener('pageshow', e => { if (e.persisted) document.body.classList.remove('leaving'); });

document.addEventListener('click', async e => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  if (editing && (a.isContentEditable || a.closest('.board, [data-edit]'))) { e.preventDefault(); return; }
  if (a.target === '_blank') return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/uploads/')) return;
  e.preventDefault();
  if (url.pathname + url.search === location.pathname + location.search) {
    const t = url.hash && document.getElementById(url.hash.slice(1));
    if (t) t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    else scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    return;
  }
  if (dirty && owner) { await save(); if (dirty) return; }
  go(url.href);
});

addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

/* keyboard: ⌘S save · arrows nudge · shift+arrows resize · delete removes */
document.addEventListener('keydown', e => {
  const t = e.target;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && owner) { e.preventDefault(); save(); return; }
  if (!editing || $('.modal')) return;
  if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
    if (e.key === 'Escape') { if (activeText) finishText(); else t.blur(); }
    else if (e.key === 'Enter' && t.matches('[data-edit]:not([data-rich]):not(.lede)')) { e.preventDefault(); t.blur(); }
    return;
  }
  const sel = $('.item.sel');
  if (!sel) return;
  const boardEl = sel.closest('.board');
  const it = findItem(boardEl, sel.dataset.id);
  if (e.key === 'Escape') { select(null); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); $('[data-act=del]', sel).click(); return; }
  if (e.key === 'Enter' && it.type === 'text') { e.preventDefault(); editText(sel, boardEl); return; }
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!d) return;
  e.preventDefault();
  if (e.shiftKey) { it.w = clamp(it.w + d[0], 1, COLS - it.x); it.h = Math.max(1, it.h + d[1]); }
  else { it.x = clamp(it.x + d[0], 0, COLS - it.w); it.y = Math.max(0, it.y + d[1]); }
  layoutBoard(boardEl);
  markDirty();
});

/* =========================================================
   Small UI: modal dialogs + toast
   ========================================================= */
function modal(build) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    const card = document.createElement('div');
    card.className = 'card';
    wrap.appendChild(card);
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    const done = v => {
      document.removeEventListener('keydown', key, true);
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 260);
      resolve(v);
    };
    document.addEventListener('keydown', key, true);
    wrap.addEventListener('pointerdown', e => { if (e.target === wrap) done(null); });
    build(card, done);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const f = card.querySelector('input, .solid, button');
    if (f) { f.focus(); if (f.select) f.select(); }
  });
}

function ask(title, value = '', type = 'text', hint = '') {
  return modal((card, done) => {
    card.innerHTML = `<h3></h3>${hint ? '<p class="hint"></p>' : ''}<form><input autocomplete="${type === 'password' ? 'current-password' : 'off'}"><div class="row"><button type="button" class="btn plain">Cancel</button><button class="btn solid">OK</button></div></form>`;
    card.querySelector('h3').textContent = title;
    if (hint) { const h = card.querySelector('.hint'); h.innerHTML = hint; h.style.marginBottom = '14px'; }
    const inp = card.querySelector('input');
    inp.type = type; inp.value = value;
    card.querySelector('form').onsubmit = e => { e.preventDefault(); done(inp.value); };
    card.querySelector('.plain').onclick = () => done(null);
  });
}

function confirmBox(title, okLabel = 'OK') {
  return modal((card, done) => {
    card.innerHTML = '<h3></h3><div class="row"><button class="btn plain">Cancel</button><button class="btn solid"></button></div>';
    card.querySelector('h3').textContent = title;
    const ok = card.querySelector('.solid');
    ok.textContent = okLabel;
    ok.onclick = () => done(true);
    card.querySelector('.plain').onclick = () => done(null);
  });
}

function info(title, html) {
  return modal((card, done) => {
    card.innerHTML = '<h3></h3><p></p><div class="row"><button class="btn solid">OK</button></div>';
    card.querySelector('h3').textContent = title;
    card.querySelector('p').innerHTML = html;
    card.querySelector('.solid').onclick = () => done(true);
  });
}

function choose(title, opts, cur) {
  return modal((card, done) => {
    card.innerHTML = '<h3></h3><div class="choices"></div>';
    card.querySelector('h3').textContent = title;
    const list = card.querySelector('.choices');
    for (const o of opts) {
      const b = document.createElement('button');
      b.textContent = o.l + (o.v === cur ? '  ✓' : '');
      if (o.v === cur) b.className = 'cur';
      b.onclick = () => done(o.v);
      list.appendChild(b);
    }
  });
}

let toastTimer;
function toast(msg, ms = 2200) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

boot();
})();

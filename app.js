(() => {
'use strict';

/* Contents
   1. Basics, lite mode, content helpers      6. Click-to-zoom
   2. Boot + page rendering                   7. Owner mode: blocks, tools, dock
   3. Socials, nav, scroll effects            8. Fonts
   4. Grid boards + text fitting               9. Saving to GitHub, login, uploads
   5. Dust on blurred photos                 10. Navigation, keyboard, dialogs */

/* =========================================================
   Where the site lives on GitHub — owner mode saves here
   ========================================================= */
const GH = { owner: 'juanjuarezarc', repo: 'JuanJuarezArc.github.io', branch: 'main' };

/* =========================================================
   Basics
   ========================================================= */
const COLS = 12;                       // grid columns on desktop
const MEDIA_TYPES = 'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollToCenter = el => el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
// Muted, looping, inline video (grid tiles and the zoom view)
function loopVideo(v) {
  v.muted = v.loop = v.autoplay = v.playsInline = true;
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  return v;
}

/* ---------- "Lite" mode ----------
   When a browser draws without the graphics chip (e.g. Chrome with "Use graphics
   acceleration" turned off), blur effects become very slow. In that case the page adds
   class "lite" to <html>, which swaps every blur for a plain, solid version (see the end
   of styles.css). Add ?lite to any address to preview it. */
const LITE_KEY = 'portfolio-lite';
const forceLite = new URLSearchParams(location.search).has('lite');
function setLite(on, remember = true) {
  document.documentElement.classList.toggle('lite', on);
  if (remember && !forceLite) { try { localStorage.setItem(LITE_KEY, on ? '1' : '0'); } catch { /* private mode */ } }
}
// A standard check: asking for 3D graphics that "fail if only slow software drawing is available"
function noGraphicsAcceleration() {
  try {
    const gl = document.createElement('canvas').getContext('webgl', { failIfMajorPerformanceCaveat: true });
    if (!gl) return true;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return false;
  } catch { return false; }
}
try { if (forceLite || localStorage.getItem(LITE_KEY) === '1') setLite(true, false); } catch { /* ignore */ }
(window.requestIdleCallback || (f => setTimeout(f, 1200)))(() => { if (!forceLite) setLite(noGraphicsAcceleration()); });
const isLite = () => document.documentElement.classList.contains('lite');

// Backup: if an animation actually draws slowly (under ~33 frames a second), use lite mode too
function watchSmoothness(ms) {
  if (isLite()) return;
  const gaps = [];
  let last = 0;
  const end = performance.now() + ms;
  const tick = now => {
    if (last) gaps.push(now - last);
    last = now;
    if (now < end) return requestAnimationFrame(tick);
    if (gaps.length >= 5 && gaps.reduce((a, b) => a + b, 0) / gaps.length > 30) setLite(true);
  };
  requestAnimationFrame(tick);
}

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
const safeSrc = s => (/^\/uploads\/(sized\/)?[\w.-]+$/.test(s || '') || /^https:\/\//.test(s || '') ? s : '');
const isVideo = s => /\.(mp4|webm)(\?|$)/i.test(s || '');
// The starter layout labelled empty boxes "Image" — that label is hidden once a picture is added
const isPlaceholderCaption = c => /^\s*image\s*$/i.test(c || '');

/* YouTube / Vimeo blocks — stored as 'yt:<id>' or 'vimeo:<id>[:<private hash>]' */
function parseVideoLink(url) {
  const u = (url || '').trim();
  let m = u.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  if (m) return 'yt:' + m[1];
  m = u.match(/vimeo\.com\/(?:.*\/)?(?:video\/)?(\d+)(?:\/([\da-f]{6,}))?/i) || u.match(/vimeo\.com\/.*[?&]h=([\da-f]+)/i);
  if (m && /^\d+$/.test(m[1])) {
    const h = m[2] || ((u.match(/[?&]h=([\da-f]+)/i) || [])[1]);
    return 'vimeo:' + m[1] + (h ? ':' + h : '');
  }
  return null;
}
function embedSrc(embed, auto) {
  const [kind, id, hash] = String(embed || '').split(':');
  if (kind === 'yt' && /^[\w-]{11}$/.test(id)) {
    return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1` +
      (auto ? `&autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&disablekb=1` : '');
  }
  if (kind === 'vimeo' && /^\d+$/.test(id)) {
    return `https://player.vimeo.com/video/${id}?dnt=1&title=0&byline=0&portrait=0` +
      (hash && /^[\da-f]+$/i.test(hash) ? `&h=${hash}` : '') + (auto ? '&background=1' : '');
  }
  return '';
}

/* =========================================================
   Boot
   ========================================================= */
async function boot() {
  try {
    token = tokenStore.get();
    if (token) {
      // owner: load the newest content straight from GitHub (Pages can lag ~1 min)
      try {
        if (!(await ghTokenProblem())) { C = await ghLoad(); owner = true; }
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
  applyFonts();

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
  renderSocials();
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
    <div class="board side" data-board="about"></div>
  </section>

  <section class="zone narrow" id="contact">
    <h2 class="reveal" data-edit="home.contactTitle"></h2>
    <div class="prose reveal" data-edit="home.contactText" data-rich></div>
    <a class="mail reveal" data-edit="site.email" data-mail></a>
    <div class="socials reveal" id="socials"></div>
    <div class="board side" data-board="contact"></div>
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

/* ---------- social links (Instagram, LinkedIn…) under Contact ---------- */
const SOCIAL_NAMES = { 'instagram.com': 'Instagram', 'linkedin.com': 'LinkedIn', 'behance.net': 'Behance', 'github.com': 'GitHub',
  'x.com': 'X', 'twitter.com': 'X', 'tiktok.com': 'TikTok', 'youtube.com': 'YouTube', 'vimeo.com': 'Vimeo',
  'pinterest.com': 'Pinterest', 'issuu.com': 'Issuu', 'facebook.com': 'Facebook', 'threads.net': 'Threads', 'dribbble.com': 'Dribbble' };
function normLink(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (/^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(u)) return 'mailto:' + u;
  if (!/^(https?:\/\/|mailto:)/i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  return /^(https?:\/\/|mailto:)[^\s<>"]+$/i.test(u) ? u : '';
}
function guessLabel(u) {
  if (u.startsWith('mailto:')) return 'Email';
  try {
    const h = new URL(u).hostname.replace(/^www\./, '');
    return SOCIAL_NAMES[h] || h.split('.')[0].replace(/^./, c => c.toUpperCase());
  } catch { return 'Link'; }
}
function renderSocials() {
  const box = $('#socials');
  if (!box) return;
  const links = C.site.links || [];
  box.innerHTML = '';
  links.forEach((l, i) => {
    const a = document.createElement('a');
    a.textContent = l.label || guessLabel(l.url);
    a.href = linkHref(l.url) || '#';
    if (/^https?:/i.test(l.url)) { a.target = '_blank'; a.rel = 'noopener'; }
    if (editing) {
      a.title = 'Click to edit';
      a.onclick = e => { e.preventDefault(); editSocial(i); };
    }
    box.appendChild(a);
  });
  if (editing) {
    const add = document.createElement('button');
    add.className = 'add-social';
    add.textContent = '+ Link';
    add.title = 'Add Instagram, LinkedIn, Behance…';
    add.onclick = () => editSocial(-1);
    box.appendChild(add);
  }
  box.hidden = !links.length && !editing;
}
async function editSocial(i) {
  const links = C.site.links = C.site.links || [];
  const cur = links[i] || { label: '', url: '' };
  const v = await modal((card, done) => {
    card.innerHTML = `<h3>${i < 0 ? 'Add a link' : 'Edit link'}</h3><p class="hint" style="margin-bottom:14px">Paste the address of your profile — e.g. instagram.com/yourname. The name fills in by itself; change it if you like.</p>
      <form><input name="url" placeholder="instagram.com/yourname" autocomplete="off"><input name="label" placeholder="Name shown (optional)" autocomplete="off" style="margin-top:8px">
      <div class="row">${i < 0 ? '' : '<button type="button" class="btn plain del">Remove</button>'}<button type="button" class="btn plain cancel">Cancel</button><button class="btn solid">${i < 0 ? 'Add' : 'OK'}</button></div></form>`;
    const f = card.querySelector('form');
    f.url.value = cur.url.replace(/^mailto:/, ''); f.label.value = cur.label || '';
    f.url.oninput = () => { const n = normLink(f.url.value); f.label.placeholder = n ? guessLabel(n) : 'Name shown (optional)'; };
    f.url.oninput();
    f.onsubmit = e => { e.preventDefault(); done({ url: f.url.value, label: f.label.value }); };
    card.querySelector('.cancel').onclick = () => done(null);
    const del = card.querySelector('.del');
    if (del) del.onclick = () => done('remove');
  });
  if (v === null) return;
  if (v === 'remove') links.splice(i, 1);
  else {
    const url = normLink(v.url);
    if (!url) { toast('That doesn’t look like a web address'); return; }
    const item = { label: v.label.trim(), url };
    if (i < 0) links.push(item); else links[i] = item;
  }
  markDirty();
  renderSocials();
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
    const hero = $('.hero'), inner = $('.hero-inner');
    if (!hero || !inner || reduceMotion) return;
    const r = hero.getBoundingClientRect();
    const p = clamp(-r.top / Math.max(1, r.height - innerHeight), 0, 1);
    inner.style.transform = `scale(${1 - p * 0.14}) translateY(${-p * 40}px)`;
    inner.style.opacity = String(clamp(1 - p * 1.15, 0, 1));
  });
}
addEventListener('scroll', onScroll, { passive: true });

/* =========================================================
   Grid board
   ========================================================= */
const boardOf = el => (C.boards[el.dataset.board] = C.boards[el.dataset.board] || { items: [] });
const findItem = (boardEl, id) => boardOf(boardEl).items.find(i => i.id === id);
const bottomOf = b => b.items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
// The board the dock adds to: whichever one is most on screen (Work, About or Contact)
function mainBoard() {
  let best = null, most = -1;
  for (const b of $$('#view .board')) {
    const r = b.getBoundingClientRect();
    const seen = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    if (seen > most) { most = seen; best = b; }
  }
  return best;
}

function renderBoard(boardEl, instant = false) {
  const b = boardOf(boardEl);
  const sel = $$('.item.sel', boardEl).map(x => x.dataset.id);
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
  sel.forEach(id => $(`.item[data-id="${id}"]`, boardEl)?.classList.add('sel'));
  markMulti();
  if (!instant) observeReveals(boardEl);
  grainFx.refresh();
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
    const frame = it.embed ? embedSrc(it.embed, it.auto) : '';
    if (frame) {
      const f = document.createElement('iframe');
      f.src = frame;
      f.title = it.caption || 'Video';
      f.loading = 'lazy';
      f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      if (it.auto) inner.classList.add('bg-video');
      inner.classList.add('embed');
      inner.appendChild(f);
    } else if (src) {
      const m = isVideo(src) ? loopVideo(document.createElement('video')) : document.createElement('img');
      if (m.tagName === 'IMG') { m.loading = 'lazy'; m.decoding = 'async'; m.alt = it.caption || ''; }
      m.draggable = false;
      if (it.fit === 'contain') m.classList.add('contain');
      // Smaller copies (800 / 1600 px): the browser downloads the smallest one that is still sharp
      // for the tile's size on this screen. The full photo is used when zooming in.
      const v = it.variants;
      if (v && m.tagName === 'IMG' && !localPreview.has(src)) {
        const set = Object.keys(v).filter(k => k !== 'w' && safeSrc(v[k])).map(k => `${v[k]} ${k}w`);
        if (set.length) {
          if (v.w) set.push(`${src} ${v.w}w`);
          m.sizes = it.blur ? '25vw' : `${(it.w / COLS * 100).toFixed(1)}vw`;   // blurred photos never need detail
          m.srcset = set.join(', ');
          m.dataset.full = src;
        }
      }
      // Fresh uploads take ~1 min to appear on GitHub Pages: show the local copy, or GitHub's raw file meanwhile
      if (owner && src.startsWith('/uploads/')) {
        m.addEventListener('error', () => { if (!m.dataset.raw) { m.dataset.raw = '1'; m.removeAttribute('srcset'); m.src = rawUrl(src); } });
      }
      m.src = localPreview.get(src) || src;
      inner.appendChild(m);
      if (!href) inner.classList.add('zoomable');   // click to view it large
      if (it.blur) {                                  // atmospheric: heavy blur + film grain, title centred on top
        inner.classList.add('blurred');
        // the grain *is* the dust: three depths of particles drifting through an angled ray
        const dust = document.createElement('span');
        dust.className = 'dust';
        dust.innerHTML = '<span class="specks fine"></span><span class="specks dark"></span><span class="specks near"></span>';
        inner.appendChild(dust);
        if (m.tagName === 'IMG') {
          if (m.complete && m.naturalWidth) captionTone(inner, m);
          else m.addEventListener('load', () => captionTone(inner, m), { once: true });
        }
      }
    } else {
      inner.classList.add('ph');
      // each empty tile gets its own soft light pattern (stable per block)
      let hsh = 2166136261;
      for (const ch of String(it.id)) hsh = Math.imul(hsh ^ ch.charCodeAt(0), 16777619) >>> 0;
      const r = n => ((Math.imul(hsh ^ (n * 0x9e3779b9), 2246822519) >>> 0) >>> 7) % 60 + 20;
      inner.style.setProperty('--ph-x', r(0) + '%'); inner.style.setProperty('--ph-y', r(5) + '%');
      inner.style.setProperty('--ph-x2', (100 - r(10)) + '%'); inner.style.setProperty('--ph-y2', (100 - r(15)) + '%');
    }
    if (it.caption && !(isPlaceholderCaption(it.caption) && (src || frame))) {
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

function sizeBoard(boardEl, m, minPx = 0) {
  const rows = bottomOf(boardOf(boardEl)) + (editing ? 3 : 0);
  boardEl.style.height = `${Math.max(rows * m.cell - m.gap, minPx, 0)}px`;
}

/* Text keeps a readable size on small screens, so it can need more room than its box.
   Give it that room: the text block grows to fit, and everything that starts below it
   moves down by the same amount (like adding a little height to the grid at that line),
   so rows stay aligned the way they are on a big screen. Only when not editing, so
   owner mode always shows the true grid positions. Returns the board's bottom in px. */
function fitText(boardEl, b, m) {
  const grow = [];
  if (!editing) {
    for (const el of $$('.item.text', boardEl)) {
      const it = b.items.find(x => x.id === el.dataset.id);
      if (!it) continue;
      const box = it.h * m.cell - m.gap;
      const need = $('.txt', el).scrollHeight;
      if (need > box + 1) grow.push({ it, line: it.y + it.h, extra: need - box + m.gap });
    }
  }
  if (!grow.length) return 0;
  let bottom = 0;
  for (const el of $$('.item', boardEl)) {
    const it = b.items.find(x => x.id === el.dataset.id);
    if (!it) continue;
    const dy = grow.reduce((sum, g) => sum + (it.y >= g.line ? g.extra : 0), 0);
    const own = grow.find(g => g.it === it);
    const h = it.h * m.cell - m.gap + (own ? own.extra : 0);
    if (dy) el.style.transform = `translate(${it.x * m.cell}px, ${it.y * m.cell + dy}px)`;
    if (own) el.style.height = `${h}px`;
    bottom = Math.max(bottom, it.y * m.cell + dy + h);
  }
  return bottom;
}

// Phones show the same grid as a laptop, just scaled to the screen width
function layoutBoard(boardEl) {
  const b = boardOf(boardEl);
  const m = metrics(boardEl);
  boardEl.style.setProperty('--cell', `${m.cell}px`);
  for (const el of $$('.item', boardEl)) {
    const it = b.items.find(x => x.id === el.dataset.id);
    if (!it) continue;
    place(el, it, m);
    // tell the browser the tile's real width, so it downloads the smallest sharp copy
    const img = el.querySelector('img[srcset]');
    if (img) img.sizes = `${Math.ceil(it.w * m.cell * (it.blur ? 0.3 : 1))}px`;
  }
  sizeBoard(boardEl, m, fitText(boardEl, b, m));
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
  boardEl.addEventListener('click', e => {
    if (editing) return;
    const inner = e.target.closest('.inner.zoomable');
    const media = inner && inner.querySelector('img, video');
    if (media) openZoom(media, inner.querySelector('.cap'));
  });
  bindDrop(boardEl);
}

/* ---------- Dust on blurred photos ----------
   Tiny specks drift slowly upward and sway, like dust in an angled ray of light
   (visible only along a diagonal band; no glow). Two layers at different depths
   move at different speeds. Scrolling stirs the air: the dust gets a soft push
   against the scroll, swirling one way going down and the other going up, then
   drifts to a stop. Runs only while a blurred tile is on screen; still for reduced
   motion and lite mode. */
const grainFx = (() => {
  let els = [];
  const visible = new Set();
  let running = false, lastT = 0, lastY = scrollY;
  let airX = 0, airY = 0, airVX = 0, airVY = 0;
  const enabled = () => !reduceMotion && !isLite();
  const seen = new IntersectionObserver(entries => {
    for (const e of entries) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); }
    kick();
  });
  function refresh() {
    els.forEach(e => seen.unobserve(e));
    visible.clear();
    els = $$('.inner.blurred .dust');
    els.forEach(e => seen.observe(e));
  }
  function kick() {
    if (running || !visible.size || !enabled()) return;
    running = true;
    lastT = 0;
    lastY = scrollY;
    requestAnimationFrame(step);
  }
  const wrap = (v, size) => ((v % size) + size) % size;
  // one entry per particle layer (matches the order in the markup): pattern size, rise speed (px/ms),
  // sway amount and period, and how strongly the stirred air moves it (depth)
  // Phones: finer particles (matching the smaller tiles) and motion scaled to match — no extra work to draw
  let K = innerWidth < 640 ? 0.55 : 1;
  addEventListener('resize', () => { K = innerWidth < 640 ? 0.55 : 1; });
  const LAYERS = [
    { size: 200, rise: 0.004, sway: 8, period: 7800, phase: 0.0, depth: 0.45 },   // fine, far
    { size: 230, rise: 0.006, sway: 10, period: 6100, phase: 2.1, depth: 0.7 },   // dark, middle
    { size: 260, rise: 0.009, sway: 14, period: 5300, phase: 4.0, depth: 1.0 },   // larger, near
  ];
  function step(t) {
    if (!visible.size || !enabled()) { running = false; return; }
    const dt = lastT ? Math.min(40, t - lastT) : 16;
    lastT = t;
    const d = scrollY - lastY;
    lastY = scrollY;
    // stirred air: a soft push against the scroll, with a sideways swirl that depends on direction
    airVY -= d * 0.0006;
    airVX += Math.abs(d) * (d > 0 ? 0.0002 : -0.0002);
    const drag = Math.pow(0.9965, dt);                // the air slowly calms down (~1 s glide)
    airVX *= drag; airVY *= drag;
    airX += airVX * dt; airY += airVY * dt;
    const tfs = LAYERS.map(L => {
      const size = L.size * K;
      const y = wrap((-t * L.rise + airY * L.depth) * K, size);
      const x = wrap((Math.sin(t / L.period + L.phase) * L.sway + t * L.rise * 0.35 + airX * L.depth) * K, size);
      return `translate3d(${(x - size).toFixed(1)}px, ${(y - size).toFixed(1)}px, 0)`;
    });
    for (const e of visible) {
      const kids = e.children;
      for (let i = 0; i < kids.length && i < tfs.length; i++) kids[i].style.transform = tfs[i];
    }
    requestAnimationFrame(step);
  }
  addEventListener('scroll', kick, { passive: true });
  return { refresh };
})();

// Blurred tiles: dark title on light photos, white title on dark ones
function captionTone(inner, img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const x = c.getContext('2d');
    const w = img.naturalWidth, h = img.naturalHeight;
    x.drawImage(img, w * 0.25, h * 0.35, w * 0.5, h * 0.3, 0, 0, 8, 8);   // the middle, where the title sits
    const d = x.getImageData(0, 0, 8, 8).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    // above ~118 (of 255) black text has more contrast than white
    inner.classList.toggle('light-bg', sum / (d.length / 4) > 118);
  } catch { /* image from another site can't be read — keep white text */ }
}

/* =========================================================
   Click-to-zoom: the image lifts out of the grid to the centre of
   the screen over a soft frosted blur. Click outside (or Esc) to return.

   Smoothness: the picture is drawn once at full size, then only moved
   and scaled (transform), which the graphics chip does without redrawing.
   The crop from grid-shape to full picture is done by scaling an outer
   frame while counter-scaling the picture inside it, with every frame
   precomputed so the two always match exactly.
   ========================================================= */
let zoomState = null;
const ZOOM_OPEN_MS = 480, ZOOM_CLOSE_MS = 400;

// iOS-style ease-out curve: cubic-bezier(.32, .72, 0, 1)
const zoomEase = (() => {
  const x1 = 0.32, y1 = 0.72, x2 = 0, y2 = 1;
  const bez = (t, a, b) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  const slope = (t, a, b) => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) t = Math.min(1, Math.max(0, t - (bez(t, x1, x2) - x) / slope(t, x1, x2)));
    return bez(t, y1, y2);
  };
})();

const naturalSize = m => (m.tagName === 'VIDEO' ? [m.videoWidth, m.videoHeight] : [m.naturalWidth, m.naturalHeight]);

// How the picture sits in the grid right now (accounts for cropping, "Fit" and the hover zoom)
function zoomGeometry(media) {
  const tile = media.closest('.inner').getBoundingClientRect();
  const [nw, nh] = naturalSize(media);
  const cs = getComputedStyle(media);
  const hover = cs.transform && cs.transform !== 'none' ? new DOMMatrixReadOnly(cs.transform).a : 1;
  const fit = cs.objectFit === 'contain' ? Math.min : Math.max;
  const k = fit(tile.width / nw, tile.height / nh) * hover;
  const dw = nw * k, dh = nh * k;
  return {
    dw,                                            // picture width as shown in the grid
    cw: Math.min(dw, tile.width),                  // visible (cropped) width
    ch: Math.min(dh, tile.height),                 // visible (cropped) height
    cx: tile.left + tile.width / 2, cy: tile.top + tile.height / 2,
  };
}

// Frames from progress p0 to p1 (0 = in the grid, 1 = zoomed), eased
function zoomFrames(z, p0, p1) {
  const { g, box } = z;
  const fx = box.left + box.width / 2, fy = box.top + box.height / 2;
  const outer = [], inner = [], N = 40;
  for (let i = 0; i <= N; i++) {
    const p = p0 + (p1 - p0) * zoomEase(i / N);
    const sx = (g.cw + (box.width - g.cw) * p) / box.width;      // frame (crop) scale
    const sy = (g.ch + (box.height - g.ch) * p) / box.height;
    const S = (g.dw + (box.width - g.dw) * p) / box.width;       // picture scale
    outer.push({ transform: `translate3d(${(g.cx - fx) * (1 - p)}px, ${(g.cy - fy) * (1 - p)}px, 0) scale(${sx}, ${sy})` });
    inner.push({ transform: `scale(${S / sx}, ${S / sy})` });
  }
  return { outer, inner };
}

function zoomRun(z, p0, p1, ms) {
  const { outer, inner } = zoomFrames(z, p0, p1);
  const opts = { duration: reduceMotion ? 1 : ms, easing: 'linear', fill: 'forwards' };
  const prev = z.anims || [];
  z.anims = [z.frame.animate(outer, opts), z.media2.animate(inner, opts)];
  prev.forEach(a => a.cancel());
  z.p0 = p0; z.p1 = p1;
  return z.anims[0].finished.catch(() => {});
}

// Where an in-flight animation currently is (so closing mid-open is seamless)
function zoomProgress(z) {
  if (z.settled) return 1;
  const a = z.anims && z.anims[0];
  if (!a) return 0;
  const d = a.effect.getTiming().duration;
  const t = Math.min(1, (a.currentTime || 0) / d);
  return z.p0 + (z.p1 - z.p0) * zoomEase(t);
}

const nextFrame = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 50); });

async function openZoom(media, capEl) {
  if (zoomState) return;
  const [nw, nh] = naturalSize(media);
  if (!nw || !nh) return;                                   // not loaded yet
  const phone = innerWidth < 640;
  const maxW = innerWidth * (phone ? 0.94 : 0.9);
  const maxH = innerHeight * (phone ? 0.78 : 0.84);
  const k = Math.min(maxW / nw, maxH / nh);
  const box = { width: nw * k, height: nh * k };
  box.left = (innerWidth - box.width) / 2;
  box.top = (innerHeight - box.height) / 2 - (capEl ? 12 : 0);

  const wrap = document.createElement('div');
  wrap.className = 'zoom';
  wrap.innerHTML = '<div class="zoom-bg"></div><div class="zoom-grain"></div><div class="zoom-frame"></div>';
  const frame = wrap.querySelector('.zoom-frame');
  Object.assign(frame.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  const isVid = media.tagName === 'VIDEO';
  const media2 = isVid ? loopVideo(document.createElement('video')) : document.createElement('img');
  if (!isVid) media2.alt = media.alt || '';
  media2.src = media.currentSrc || media.src;
  if (isVid) media2.currentTime = media.currentTime;
  media2.draggable = false;
  const pzEl = document.createElement('div');               // holds the viewer's own zoom & pan
  pzEl.className = 'zoom-pz';
  pzEl.appendChild(media2);
  frame.appendChild(pzEl);
  if (capEl && capEl.textContent.trim()) {
    const cap = document.createElement('div');
    cap.className = 'zoom-cap';
    cap.textContent = capEl.textContent;
    cap.style.top = `${box.top + box.height + 16}px`;
    wrap.appendChild(cap);
  }

  const z = zoomState = { wrap, frame, media2, pzEl, media, inner: media.closest('.inner'), box, w: innerWidth, pz: { s: 1, x: 0, y: 0 } };
  z.g = zoomGeometry(media);
  const first = zoomFrames(z, 0, 0);                        // sits exactly over the grid picture
  frame.style.transform = first.outer[0].transform;
  media2.style.transform = first.inner[0].transform;

  wrap.addEventListener('touchmove', e => e.preventDefault(), { passive: false });   // no page scrolling while zoomed
  wrap.addEventListener('click', e => {
    if (z.moved) { z.moved = false; return; }               // that was a drag or pinch, not a click
    if (!frame.contains(e.target)) closeZoom();
  });
  bindPanZoom(z);
  document.body.appendChild(wrap);
  z.inner.classList.add('zoom-src');                        // the original "lifts out"

  // Let the full picture decode and get drawn once before anything moves
  if (!isVid && media2.decode) await Promise.race([media2.decode().catch(() => {}), new Promise(r => setTimeout(r, 400))]);
  await nextFrame();
  await nextFrame();
  if (zoomState !== z || z.closing) return;
  wrap.classList.add('open');
  watchSmoothness(ZOOM_OPEN_MS);
  zoomRun(z, 0, 1, ZOOM_OPEN_MS).then(() => {
    if (zoomState !== z || z.closing) return;
    // Settle: keep the final position as plain styles and drop the animation layers,
    // so zooming in further redraws the picture sharply instead of stretching it.
    frame.style.transform = 'none';
    media2.style.transform = 'none';
    (z.anims || []).forEach(a => a.cancel());
    z.anims = null;
    frame.style.willChange = 'auto';
    media2.style.willChange = 'auto';
    z.settled = true;
    z.ready = true;
    const full = media.dataset.full;
    if (full && !isVid && !(media.currentSrc || '').endsWith(full)) {
      const hi = new Image();
      hi.src = full;
      hi.decode().then(() => { if (zoomState === z) media2.src = full; }).catch(() => {});
    }
  });
}

/* ---------- zooming in further inside the zoom view ----------
   Click/tap the photo: zoom 2.5x on that spot (again to zoom back out).
   Pinch (trackpad or two fingers) to zoom freely; drag or two-finger scroll to move around. */
const PZ_MAX = 4;

function pzClamp(z) {
  const t = z.pz, W = z.box.width, H = z.box.height;
  t.s = clamp(t.s, 1, PZ_MAX);
  t.x = clamp(t.x, W - W * t.s, 0);
  t.y = clamp(t.y, H - H * t.s, 0);
}
function pzZoomAt(z, s2, px, py) {                          // keeps the point (px, py) under the finger/cursor
  const t = z.pz, s1 = t.s;
  s2 = clamp(s2, 1, PZ_MAX);
  t.x = px - (px - t.x) * (s2 / s1);
  t.y = py - (py - t.y) * (s2 / s1);
  t.s = s2;
  pzClamp(z);
}
function pzApply(z, animate) {
  const t = z.pz;
  z.pzEl.style.transition = animate ? 'transform .4s cubic-bezier(.32, .72, 0, 1)' : 'none';
  z.pzEl.style.transform = `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.s})`;
  z.wrap.classList.toggle('zoomed-in', t.s > 1.01);
  // While moving: fast GPU scaling. Once still: redraw crisply at the new size.
  z.pzEl.style.willChange = 'transform';
  clearTimeout(z.sharpT);
  z.sharpT = setTimeout(() => { z.pzEl.style.willChange = 'auto'; }, animate ? 450 : 180);
}

function bindPanZoom(z) {
  const { wrap, frame } = z;
  const pts = new Map();
  let base = null;
  const local = e => { const r = frame.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const snapshot = () => ({ s: z.pz.s, x: z.pz.x, y: z.pz.y, p: [...pts.values()].map(v => v.slice()) });

  wrap.addEventListener('pointerdown', e => {
    if (!z.ready || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pts.set(e.pointerId, local(e));
    if (pts.size === 1) z.moved = false;
    base = snapshot();
  });
  wrap.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !base) return;
    pts.set(e.pointerId, local(e));
    const p = [...pts.values()];
    if (p.length === 1 && base.p.length === 1) {            // drag to move around
      if (z.pz.s <= 1.01) return;
      const dx = p[0][0] - base.p[0][0], dy = p[0][1] - base.p[0][1];
      if (!z.moved && Math.hypot(dx, dy) < 5) return;
      z.moved = true;
      wrap.classList.add('dragging');
      z.pz.x = base.x + dx; z.pz.y = base.y + dy;
      pzClamp(z);
    } else if (p.length >= 2 && base.p.length >= 2) {      // two-finger pinch
      const d0 = Math.hypot(base.p[1][0] - base.p[0][0], base.p[1][1] - base.p[0][1]) || 1;
      const d1 = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
      const m0 = [(base.p[0][0] + base.p[1][0]) / 2, (base.p[0][1] + base.p[1][1]) / 2];
      const m1 = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
      const s2 = clamp(base.s * d1 / d0, 1, PZ_MAX);
      z.moved = true;
      z.pz.x = m0[0] - (m0[0] - base.x) * (s2 / base.s) + (m1[0] - m0[0]);
      z.pz.y = m0[1] - (m0[1] - base.y) * (s2 / base.s) + (m1[1] - m0[1]);
      z.pz.s = s2;
      pzClamp(z);
    } else return;
    pzApply(z, false);
  });
  const lift = e => {
    if (!pts.delete(e.pointerId)) return;
    base = pts.size ? snapshot() : null;                    // re-anchor when one finger lifts
    if (!pts.size) wrap.classList.remove('dragging');
  };
  wrap.addEventListener('pointerup', lift);
  wrap.addEventListener('pointercancel', lift);

  frame.addEventListener('click', e => {                    // click / tap the photo: zoom in on that spot, or back out
    if (!z.ready || z.moved) return;
    const [px, py] = local(e);
    if (z.pz.s > 1.01) z.pz = { s: 1, x: 0, y: 0 };
    else pzZoomAt(z, 2.5, px, py);
    pzApply(z, true);
  });

  wrap.addEventListener('wheel', e => {
    e.preventDefault();                                     // never scroll the page behind
    if (!z.ready) return;
    if (e.ctrlKey) {                                        // trackpad pinch (Chrome, Firefox) or ctrl + wheel
      const [px, py] = local(e);
      pzZoomAt(z, z.pz.s * Math.exp(-e.deltaY * 0.01), px, py);
    } else if (z.pz.s > 1.01) {                             // two-finger scroll moves around
      z.pz.x -= e.deltaX; z.pz.y -= e.deltaY;
      pzClamp(z);
    } else return;
    pzApply(z, false);
  }, { passive: false });

  // Safari on Mac reports trackpad pinch as "gesture" events (on iPhone the touch code above handles it)
  let g0 = 1;
  wrap.addEventListener('gesturestart', e => { e.preventDefault(); g0 = z.pz.s; });
  wrap.addEventListener('gesturechange', e => {
    e.preventDefault();
    if (!z.ready || pts.size >= 2) return;
    const [px, py] = local(e);
    pzZoomAt(z, g0 * e.scale, px, py);
    pzApply(z, false);
  });
}

async function closeZoom() {
  const z = zoomState;
  if (!z || z.closing) return;
  z.closing = true;
  z.ready = false;
  if (z.pz.s > 1.01) { z.pz = { s: 1, x: 0, y: 0 }; pzApply(z, true); }   // zoom back out as it closes
  z.wrap.classList.remove('open');
  const p = zoomProgress(z);
  if (p > 0) await zoomRun(z, p, 0, Math.max(200, ZOOM_CLOSE_MS * p));
  z.inner.classList.remove('zoom-src');
  z.wrap.remove();
  if (zoomState === z) zoomState = null;
}

// Start decoding the full picture as soon as the pointer is over it, so the click is instant
document.addEventListener('pointerover', e => {
  const inner = e.target.closest && e.target.closest('.inner.zoomable');
  const img = inner && inner.querySelector('img');
  if (!img || img._predecoded || !img.complete) return;
  img._predecoded = true;
  const pre = new Image();
  pre.src = img.currentSrc || img.src;
  if (pre.decode) pre.decode().catch(() => {});
}, { passive: true });

document.addEventListener('keydown', e => {
  if (!zoomState) return;
  if (e.key === 'Escape') closeZoom();
  else if ([' ', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) e.preventDefault();
});
addEventListener('resize', () => { if (zoomState && innerWidth !== zoomState.w) closeZoom(); });

/* =========================================================
   Owner mode — dragging, resizing, tools
   ========================================================= */
function toolsHTML(it) {
  const b = (act, label, title) => `<button type="button" data-act="${act}" title="${title || label}">${label}</button>`;
  return `<div class="tools">${
    it.type === 'text'
      ? b('size', 'Aa', 'Text size') + b('edit', 'Edit', 'Edit text')
      : it.embed
        ? b('video', 'Video link', 'Change the YouTube / Vimeo link') + b('auto', it.auto ? 'Player' : 'Loop', it.auto ? 'Show a normal player with sound and controls' : 'Play silently on a loop, like a moving image') + b('caption', 'Caption')
        : b('replace', 'Replace', 'Replace image or video') + b('blur', it.blur ? 'Sharp' : 'Blur', it.blur ? 'Show the photo sharp' : 'Heavily blur the photo and add grain, with the caption on top') + b('video', 'Video link', 'Use a YouTube / Vimeo video instead') + b('fit', 'Fit', 'Fill frame / show whole image') + b('caption', 'Caption')
  }${b('link', 'Link', 'Link to a project or website')}${
    it.link && it.link.startsWith('p:') ? b('open', 'Open ↗', 'Open the linked project page') : ''
  }${b('front', '↑', 'Bring to front')}${b('dup', '⧉', 'Duplicate')}${b('del', '✕', 'Delete')}</div><div class="handle" title="Drag to resize"></div>`;
}

function select(el) {
  $$('.item.sel').forEach(x => x !== el && x.classList.remove('sel'));
  if (el) el.classList.add('sel');
  markMulti();
}

/* ---------- selecting several blocks ----------
   Shift/⌘-click adds or removes a block · drag a box on empty grid · ⌘A selects the whole grid.
   Dragging any selected block (or the arrow keys) moves the whole group; Delete removes it. */
const selectedIn = boardEl => $$('.item.sel', boardEl);
// Hide the per-block toolbars while several are selected (they'd only apply to one)
function markMulti() { $$('#view .board').forEach(b => b.classList.toggle('multi', selectedIn(b).length > 1)); }
function announceSelection(boardEl) {
  const n = selectedIn(boardEl).length;
  if (n > 1) toast(`${n} blocks selected — drag one to move them all`);
}
function toggleSelect(el) {
  const boardEl = el.closest('.board');
  $$('.item.sel').forEach(x => { if (x.closest('.board') !== boardEl) x.classList.remove('sel'); });   // one grid at a time
  el.classList.toggle('sel');
  markMulti();
  announceSelection(boardEl);
}
function selectAll(boardEl) {
  $$('.item.sel').forEach(x => { if (x.closest('.board') !== boardEl) x.classList.remove('sel'); });
  $$('.item', boardEl).forEach(x => x.classList.add('sel'));
  markMulti();
  announceSelection(boardEl);
}

// Drag a box on empty grid space to select every block it touches
function marquee(e, boardEl, additive) {
  if (e.pointerType === 'mouse') e.preventDefault();          // no text selection while dragging
  const m = metrics(boardEl), b = boardOf(boardEl);
  const r0 = boardEl.getBoundingClientRect();
  const ox = r0.left + scrollX, oy = r0.top + scrollY;          // board corner on the page
  const x0 = e.pageX - ox, y0 = e.pageY - oy;
  const keep = new Set(additive ? selectedIn(boardEl) : []);
  let box = null;
  const onMove = ev => {
    const x1 = ev.pageX - ox, y1 = ev.pageY - oy;
    if (!box) {
      if (Math.hypot(x1 - x0, y1 - y0) < 5) return;
      box = document.createElement('div');
      box.className = 'marquee';
      boardEl.appendChild(box);
    }
    const L = Math.min(x0, x1), T = Math.min(y0, y1), R = Math.max(x0, x1), B = Math.max(y0, y1);
    Object.assign(box.style, { left: `${L}px`, top: `${T}px`, width: `${R - L}px`, height: `${B - T}px` });
    for (const el of $$('.item', boardEl)) {
      const it = b.items.find(x => x.id === el.dataset.id);
      if (!it) continue;
      const ix = it.x * m.cell, iy = it.y * m.cell, iw = it.w * m.cell - m.gap, ih = it.h * m.cell - m.gap;
      const hit = ix < R && ix + iw > L && iy < B && iy + ih > T;
      el.classList.toggle('sel', keep.has(el) || hit);
    }
    markMulti();
    if (ev.clientY > innerHeight - 70) scrollBy(0, 14);
    else if (ev.clientY < 70) scrollBy(0, -14);
  };
  const onUp = () => {
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onUp);
    if (box) { box.remove(); announceSelection(boardEl); }
    else if (!additive) select(null);                          // a plain click on empty grid clears the selection
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
}

// Move every selected block together, keeping the group inside the grid
function dragGroup(e, boardEl, els) {
  e.preventDefault();
  const m = metrics(boardEl);
  const sx = e.pageX, sy = e.pageY;
  const parts = els.map(el => ({ el, it: findItem(boardEl, el.dataset.id) })).filter(p => p.it)
    .map(p => Object.assign(p, { x: p.it.x, y: p.it.y }));
  const minX = Math.min(...parts.map(p => p.x)), maxR = Math.max(...parts.map(p => p.x + p.it.w));
  const minY = Math.min(...parts.map(p => p.y));
  let moved = false, gx = 0, gy = 0;
  const onMove = ev => {
    const dx = ev.pageX - sx, dy = ev.pageY - sy;
    if (!moved) {
      if (Math.hypot(dx, dy) < 4) return;
      moved = true;
      parts.forEach(p => p.el.classList.add('dragging'));
    }
    gx = clamp(Math.round(dx / m.cell), -minX, COLS - maxR);
    gy = Math.max(-minY, Math.round(dy / m.cell));
    for (const p of parts) {
      p.it.x = p.x + gx; p.it.y = p.y + gy;
      p.el.style.transform = `translate(${p.x * m.cell + dx}px, ${p.y * m.cell + dy}px)`;
    }
    sizeBoard(boardEl, m);
    if (ev.clientY > innerHeight - 70) scrollBy(0, 14);
    else if (ev.clientY < 70) scrollBy(0, -14);
  };
  const onUp = () => {
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onUp);
    if (!moved) return;
    for (const p of parts) { p.el.classList.remove('dragging'); place(p.el, p.it, m); }
    sizeBoard(boardEl, m);
    if (gx || gy) markDirty();
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
}

async function deleteSelected(boardEl) {
  const ids = new Set(selectedIn(boardEl).map(el => el.dataset.id));
  if (!ids.size || !await confirmBox(ids.size > 1 ? `Delete these ${ids.size} blocks?` : 'Delete this block?', 'Delete')) return;
  const b = boardOf(boardEl);
  b.items = b.items.filter(i => !ids.has(i.id));
  select(null);
  markDirty();
  renderBoard(boardEl, true);
}
function focusBlock(boardEl, id) {
  const el = $(`.item[data-id="${id}"]`, boardEl);
  select(el);
  scrollToCenter(el);
  return el;
}
function addBlock(boardEl, it) {
  boardOf(boardEl).items.push(it);
  markDirty();
  renderBoard(boardEl, true);
  return focusBlock(boardEl, it.id);
}

function onBoardPointer(e, boardEl) {
  if (!editing || e.button !== 0) return;
  const el = e.target.closest('.item');
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  if (!el) { marquee(e, boardEl, additive); return; }
  if (e.target.closest('.tools') || e.target.isContentEditable) return;
  if (additive) { e.preventDefault(); toggleSelect(el); return; }
  const handle = e.target.closest('.handle');
  const group = selectedIn(boardEl);
  if (!handle && el.classList.contains('sel') && group.length > 1) { dragGroup(e, boardEl, group); return; }
  select(el);
  drag(e, boardEl, el, findItem(boardEl, el.dataset.id), handle ? 'resize' : 'move');
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
      setMedia(it, up);
      break;
    }
    case 'video': {
      const v = await askVideoLink(it.embed ? 'Change video link' : 'Use a YouTube or Vimeo video');
      if (!v) return;
      it.embed = v;
      break;
    }
    case 'auto':
      it.auto = !it.auto;
      toast(it.auto ? 'Plays silently on a loop' : 'Normal player with sound and controls');
      break;
    case 'fit': it.fit = it.fit === 'contain' ? 'cover' : 'contain'; break;
    case 'blur':
      it.blur = !it.blur;
      if (it.blur && !it.caption) toast('Blurred — add a Caption to show a title on top');
      break;
    case 'caption': {
      const cur = isPlaceholderCaption(it.caption) ? '' : (it.caption || '');
      const v = await ask('Caption', cur, 'text', 'Shown when hovering the image. Leave empty for none.');
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
      if (up) { setMedia(it, up); markDirty(); renderBoard(boardEl, true); }
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
    if (up.variants) last.variants = up.variants;
    b.items.push(last);
    x += w; rowH = Math.max(rowH, h);
    markDirty();
    renderBoard(boardEl, true);
  }
  if (last) focusBlock(boardEl, last.id);
}

/* =========================================================
   Owner mode — page text, format bar, dock
   ========================================================= */
function setEditing(on) {
  if (!on) { const fp = $('#fontPanel'); if (fp) fp.remove(); finishText(); }
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
  renderSocials();
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
    <button class="edit-only" data-dock="video" title="Add a YouTube or Vimeo video — any size">+ Video link</button>
    <button class="edit-only" data-dock="text">+ Text</button>
    <button class="edit-only" data-dock="fonts" title="Choose fonts for titles, subtitles, body and small text">Fonts</button>
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
    case 'video': {
      if (!boardEl) return;
      const v = await askVideoLink('Add a YouTube or Vimeo video');
      if (!v) return;
      addBlock(boardEl, { id: uid(), type: 'image', x: 0, y: bottomOf(boardOf(boardEl)), w: 8, h: 5, embed: v, caption: '' });
      toast('Video added — drag to place it, then Save');
      break;
    }
    case 'fonts': toggleFontPanel(); break;
    case 'text': {
      if (!boardEl) return;
      const el = addBlock(boardEl, { id: uid(), type: 'text', x: 0, y: bottomOf(boardOf(boardEl)), w: 5, h: 2, size: 'm', html: '<p>New text</p>' });
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
  const boardEl = $('.board[data-board="work"]');
  if (boardEl) addBlock(boardEl, tile);
  else { wb.items.push(tile); markDirty(); }
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
   Fonts — one per type of text, chosen in owner mode (dock → Fonts).
   Stored in content.json as site.fonts; Google Fonts load on demand.
   ========================================================= */
const FONT_ROLES = [
  { key: 'name', label: 'Your name', hint: 'The big name at the top of the home page', follows: 'title' },
  { key: 'title', label: 'Titles', hint: 'Big headings and project names' },
  { key: 'subtitle', label: 'Subtitles', hint: 'The lines under headings' },
  { key: 'body', label: 'Body text', hint: 'About, Contact and text blocks' },
  { key: 'small', label: 'Small text', hint: 'Menu, captions and footer' },
];
const SYSTEM_FONT = 'System (SF Pro)';
// Classic fonts are built into Macs, iPhones and most computers: nothing is downloaded
// (other devices use the closest match in the list). [name, kind, CSS font stack]
const CLASSIC = [
  [SYSTEM_FONT, 'sans', '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif'],
  ['Helvetica', 'sans', '"Helvetica Neue", Helvetica, Arial, sans-serif'],
  ['Arial', 'sans', 'Arial, "Helvetica Neue", Helvetica, sans-serif'],
  ['Avenir Next', 'sans', '"Avenir Next", Avenir, "Helvetica Neue", Arial, sans-serif'],
  ['Futura', 'sans', 'Futura, "Century Gothic", "Avenir Next", sans-serif'],
  ['Gill Sans', 'sans', '"Gill Sans", "Gill Sans MT", Calibri, sans-serif'],
  ['Optima', 'sans', 'Optima, Candara, "Segoe UI", sans-serif'],
  ['Verdana', 'sans', 'Verdana, Geneva, sans-serif'],
  ['Trebuchet MS', 'sans', '"Trebuchet MS", "Lucida Grande", sans-serif'],
  ['Times New Roman', 'serif', '"Times New Roman", Times, serif'],
  ['Georgia', 'serif', 'Georgia, "Times New Roman", serif'],
  ['Baskerville', 'serif', 'Baskerville, "Baskerville Old Face", "Times New Roman", serif'],
  ['Didot', 'serif', 'Didot, "Bodoni MT", "Times New Roman", serif'],
  ['Palatino', 'serif', 'Palatino, "Palatino Linotype", "Book Antiqua", serif'],
  ['American Typewriter', 'mono', '"American Typewriter", "Courier New", Courier, monospace'],
  ['Courier New', 'mono', '"Courier New", Courier, monospace'],
  ['Snell Roundhand', 'script', '"Snell Roundhand", "Apple Chancery", "Brush Script MT", cursive'],
  ['Apple Chancery', 'script', '"Apple Chancery", "Snell Roundhand", "Brush Script MT", cursive'],
  ['Brush Script MT', 'script', '"Brush Script MT", "Brush Script Std", "Snell Roundhand", cursive'],
];
// Google Fonts, in menu order. "Name" = weights 300–700 · "Name:4" = 400–700 ·
// "Name:<axes>" = exactly those · a trailing "!" = only one weight (no bold).
const GOOGLE = {
  sans: ['Inter', 'Geist', 'Instrument Sans:4', 'DM Sans', 'Manrope', 'Space Grotesk', 'Hanken Grotesk', 'Schibsted Grotesk:4',
    'Familjen Grotesk:4', 'Bricolage Grotesque', 'IBM Plex Sans', 'Archivo', 'Work Sans', 'Public Sans', 'Plus Jakarta Sans',
    'Figtree', 'Outfit', 'Sora', 'Urbanist', 'Lexend', 'Epilogue', 'Karla', 'Rubik', 'Barlow', 'Montserrat', 'Poppins',
    'Raleway', 'Josefin Sans', 'Roboto', 'Syne:4'],
  serif: ['Instrument Serif:ital@0;1!', 'Playfair Display:4', 'Cormorant', 'Cormorant Garamond', 'EB Garamond:4',
    'Libre Caslon Text:4', 'Libre Baskerville:wght@400;700', 'Fraunces', 'Newsreader', 'Source Serif 4', 'Lora:4',
    'Merriweather', 'Crimson Pro', 'Spectral', 'Literata', 'PT Serif:wght@400;700', 'Noto Serif Display'],
  display: ['DM Serif Display!', 'Bodoni Moda:4', 'Abril Fatface!', 'Gloock!', 'Young Serif!', 'Prata!', 'Cinzel:4',
    'Marcellus!', 'Bebas Neue!|sans', 'Anton!|sans', 'Archivo Black!|sans', 'Oswald|sans', 'Unbounded|sans'],
  cursive: ['Pinyon Script!', 'Great Vibes!', 'Allura!', 'Parisienne!', 'Italianno!', 'Alex Brush!', 'Petit Formal Script!',
    'Imperial Script!', 'Corinthia:wght@400;700', 'Tangerine:wght@400;700', 'Monsieur La Doulaise!', 'Mrs Saint Delafield!',
    'Herr Von Muellerhoff!', 'WindSong:wght@400;500', 'Sacramento!', 'La Belle Aurore!', 'Homemade Apple!',
    'Dancing Script:4', 'Caveat:4', 'Pacifico!'],
  mono: ['Space Mono:wght@400;700', 'IBM Plex Mono', 'JetBrains Mono', 'Geist Mono', 'Roboto Mono', 'Source Code Pro',
    'Fira Code', 'DM Mono:wght@300;400;500!', 'Martian Mono', 'Courier Prime:wght@400;700'],
};
function googleFont(spec, group) {
  let [rest, kind = { display: 'serif', cursive: 'script' }[group] || group] = spec.split('|');
  const single = rest.endsWith('!');
  if (single) rest = rest.slice(0, -1);
  let [name, axes] = rest.split(':');
  if (axes === '4') axes = 'wght@400;500;600;700';
  else if (!axes && !single) axes = 'wght@300;400;500;600;700';
  return Object.assign({ name, kind }, group !== kind ? { group } : {},
    { g: name.replace(/ /g, '+') + (axes ? ':' + axes : '') }, single ? { bold: false } : {});
}
// Fine & light: thin cuts of clean fonts. [family, weight used for that text, kind]
const FINE = [
  ['Inter', 100], ['Raleway', 100], ['Josefin Sans', 100], ['Outfit', 100], ['Urbanist', 100], ['Lexend', 100],
  ['IBM Plex Sans', 100], ['Roboto', 100], ['Montserrat', 200], ['Work Sans', 200], ['Poppins', 200], ['Manrope', 200],
  ['Jost', 200], ['Mulish', 200], ['Quicksand', 300], ['Lato', 300],
  ['Fraunces', 100, 'serif'], ['Spectral', 200, 'serif'], ['Cormorant Garamond', 300, 'serif'], ['Cormorant', 300, 'serif'],
];
const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light' };
// Couture: refined designer scripts and high-contrast fashion italics.
// Scripts use the Google spec format above; italics are [family, weights].
const COUTURE_SCRIPTS = ['Ballet!', 'Luxurious Script!', 'Bonheur Royale!', 'Carattere!', 'MonteCarlo!', 'Whisper!',
  'Waterfall!', 'Rouge Script!', 'Lavishly Yours!', 'Mea Culpa!', 'Ephesis!', 'Fleur De Leah!', 'Ms Madi!',
  'The Nautigal:wght@400;700', 'Qwitcher Grypen:wght@400;700', 'Birthstone!', 'Moon Dance!', 'Updock!'];
const COUTURE_ITALICS = [['Bodoni Moda', '400;500;600;700'], ['Noto Serif Display', '300;400;500;600;700'],
  ['Playfair Display', '400;500;600;700'], ['Cormorant Garamond', '300;400;500;600;700'], ['Cormorant', '300;400;500;600;700'],
  ['EB Garamond', '400;500;600;700'], ['Newsreader', '300;400;500;600;700'], ['Libre Caslon Text', '400;700'],
  ['Instrument Serif', '']];
// Every font: { name, kind (sans/serif/mono/script), group (menu section, defaults to kind),
//               css or g (Google spec), family (if the menu name differs), bold, weight (thin cuts) }
const FONTS = [
  ...CLASSIC.map(([name, kind, css]) => ({ name, kind, group: 'classic', css })),
  ...Object.entries(GOOGLE).flatMap(([group, list]) => list.map(spec => googleFont(spec, group))),
  ...FINE.map(([family, weight, kind = 'sans']) => ({
    name: `${family} ${WEIGHT_NAMES[weight]}`, family, kind, group: 'fine', weight,
    g: `${family.replace(/ /g, '+')}:wght@${weight};400`,
  })),
  ...COUTURE_SCRIPTS.map(spec => Object.assign(googleFont(spec, 'cursive'), { group: 'couture' })),
  ...COUTURE_ITALICS.map(([family, weights]) => Object.assign({
    name: `${family} Italic`, family, kind: 'serif', group: 'couture', italic: true,
    g: family.replace(/ /g, '+') + (weights ? ':ital,wght@' + weights.split(';').map(w => '1,' + w).join(';') : ':ital@1'),
  }, weights ? {} : { bold: false })),
  { name: 'Cormorant Upright', kind: 'serif', group: 'couture', g: 'Cormorant+Upright:wght@300;400;500;600;700' },
];
const FALLBACK = { sans: '-apple-system, Helvetica, Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, monospace', script: '"Snell Roundhand", "Apple Chancery", cursive' };
const fontByName = n => FONTS.find(f => f.name === n) || FONTS[0];
const fontCss = f => f.css || `"${f.family || f.name}", ${FALLBACK[f.kind]}`;

function applyFonts() {
  const chosen = (C.site && C.site.fonts) || {};
  const root = document.documentElement;
  const families = new Set();
  for (const r of FONT_ROLES) {
    if (r.follows && !chosen[r.key]) {                          // "Same as titles": let the CSS fall back to that font
      ['font', 'weight', 'style'].forEach(v => root.style.removeProperty(`--${v}-${r.key}`));
      delete root.dataset[`${r.key}Kind`];
      continue;
    }
    const f = fontByName(chosen[r.key]);
    if (r.follows) {                                            // its own choice: spacing and weight to match that font
      root.dataset[`${r.key}Kind`] = f.kind;
      root.style.setProperty(`--weight-${r.key}`, String(f.weight || (f.bold === false ? 400 : 600)));
      root.style.setProperty(`--style-${r.key}`, f.italic ? 'italic' : 'normal');
      root.style.setProperty(`--font-${r.key}`, fontCss(f));
      if (f.g) families.add(f.g);
      continue;
    }
    root.style.setProperty(`--font-${r.key}`, fontCss(f));
    root.style.setProperty(`--weight-${r.key}`, f.weight ? String(f.weight) : '');   // thin cuts
    root.style.setProperty(`--style-${r.key}`, f.italic ? 'italic' : '');             // fashion italics
    if (f.g) families.add(f.g);
    if (r.key === 'title') {
      root.dataset.titleKind = f.kind;                         // serif/mono/script titles get looser spacing
      root.style.setProperty('--title-weight', String(f.weight || (f.bold === false ? 400 : 600)));
      root.style.setProperty('--title-weight-l', String(f.weight || (f.bold === false ? 400 : 500)));
    }
  }
  let link = $('#gfonts');
  if (!families.size) { if (link) link.remove(); return; }
  const href = 'https://fonts.googleapis.com/css2?' + [...families].map(g => 'family=' + g).join('&') + '&display=swap';
  if (link && link.getAttribute('href') === href) return;
  if (!link) { link = document.createElement('link'); link.id = 'gfonts'; link.rel = 'stylesheet'; document.head.appendChild(link); }
  link.onload = () => { if (document.fonts) document.fonts.ready.then(relayoutBoards); };
  link.href = href;
}
// Text can change height with a new font, so re-fit the grids
const relayoutBoards = () => $$('#view .board').forEach(layoutBoard);

function toggleFontPanel() {
  let panel = $('#fontPanel');
  if (panel) { panel.remove(); return; }
  const chosen = C.site.fonts = C.site.fonts || {};
  const groups = [['classic', 'Classic — built in'], ['sans', 'Sans-serif'], ['serif', 'Serif'], ['display', 'Display (big titles)'],
    ['couture', 'Couture — designer scripts & italics'], ['cursive', 'Cursive & script'], ['fine', 'Fine & light'],
    ['mono', 'Monospace']];
  const options = cur => groups.map(([k, label]) =>
    `<optgroup label="${label}">${FONTS.filter(f => (f.group || f.kind) === k).map(f =>
      `<option${f.name === cur ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</optgroup>`).join('');
  panel = document.createElement('div');
  panel.id = 'fontPanel';
  panel.className = 'fontpanel';
  panel.innerHTML = '<h3>Fonts</h3>' + FONT_ROLES.map(r => `
    <label class="fontrow">
      <span><b>${r.label}</b><small>${r.hint}</small></span>
      <select data-role="${r.key}">${r.follows ? `<option value=""${chosen[r.key] ? '' : ' selected'}>Same as ${esc(FONT_ROLES.find(x => x.key === r.follows).label.toLowerCase())}</option>` : ''}${
        options(r.follows && !chosen[r.key] ? '' : fontByName(chosen[r.key]).name)}</select>
    </label>`).join('') +
    '<div class="row"><button type="button" class="btn plain" data-f="reset">Reset all</button><button type="button" class="btn solid" data-f="done">Done</button></div>';
  panel.addEventListener('change', e => {
    const sel = e.target.closest('select');
    if (!sel) return;
    const role = FONT_ROLES.find(r => r.key === sel.dataset.role);
    // an empty choice means "same as titles"; elsewhere the system font is the default, so it isn't stored
    if (!sel.value || (sel.value === SYSTEM_FONT && !role.follows)) delete chosen[role.key]; else chosen[role.key] = sel.value;
    applyFonts();
    relayoutBoards();
    markDirty();
  });
  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    if (b.dataset.f === 'done') { panel.remove(); return; }
    C.site.fonts = {};
    panel.remove();
    applyFonts();
    relayoutBoards();
    markDirty();
    toggleFontPanel();
  });
  document.body.appendChild(panel);
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
const COPY_SIZES = [800, 1200, 1600];

// Smaller copies of a photo for the grid (PNG stays PNG so see-through drawings keep their background)
async function makeCopies(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return null;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return null; }
  const copies = { w: bmp.width, list: [] };
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  for (const size of COPY_SIZES) {
    if (bmp.width <= size * 1.15) continue;          // the original is already about this small
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = Math.round(bmp.height * size / bmp.width);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, type, 0.82));
    if (blob) copies.list.push({ size, blob, ext: type === 'image/png' ? 'png' : 'jpg' });
  }
  if (bmp.close) bmp.close();
  return copies.list.length ? copies : null;
}

// Put an upload into a block: the photo plus its smaller copies
function setMedia(it, up) {
  it.src = up.url;
  if (up.variants) it.variants = up.variants; else delete it.variants;
  delete it.embed; delete it.auto;
}

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

// Checks a token step by step and returns null if it can edit the site,
// or a plain-English reason (including GitHub's own words) if it can't.
async function ghTokenProblem() {
  let r;
  try { r = await gh('GET', ''); } catch { return 'Could not reach GitHub — check your connection and try again.'; }
  if (r.status === 401) return 'GitHub doesn’t recognise that token. It may be mistyped, expired or deleted — copy it again.';
  if (r.status === 403 || r.status === 404) return `That token can’t see ${GH.repo}. Under “Repository access”, pick “Only select repositories” and choose it.`;
  if (!r.ok) return `GitHub error ${r.status} while checking the token.`;
  // Write test: creating an unused, invisible blob needs Contents: write
  try { r = await gh('POST', '/git/blobs', { content: 'portfolio-login-check', encoding: 'utf-8' }); }
  catch { return 'Could not reach GitHub — check your connection and try again.'; }
  if (r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return `That token can read the site but GitHub won’t let it save (${r.status}: ${j.message || 'no details'}). ` +
         'Set Repository permissions → Contents to “Read and write”, or use the simple token link below.';
}

// Turn a failed GitHub response into a plain-English message
async function ghProblem(r) {
  if (!r) return 'Could not reach GitHub — check your connection';
  if (r.status === 401) return 'Your GitHub token expired — log in again';
  const j = await r.clone().json().catch(() => ({}));
  if (r.status === 403 || r.status === 404) return `GitHub won’t let this token save (${r.status}: ${j.message || 'no details'}) — log in with a token that can edit the site`;
  if (r.status === 409 || r.status === 422) return 'The site changed somewhere else (another tab?). Copy your text, reload, and redo the change.';
  return `GitHub refused the change (${r.status}${j.message ? ': ' + j.message : ''})`;
}

function relogin() {
  tokenStore.set(null);
  token = null;
  login();
}
// Explain a failed write; a bad or expired token asks for a new one (unsaved edits stay on the page)
async function ghFailed(r) {
  toast(await ghProblem(r), 8000);
  if (r && [401, 403, 404].includes(r.status)) relogin();
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
  } else await ghFailed(r);
  updateDock();
}

const TOKEN_HELP =
  'Paste a GitHub access token that can edit <b>' + esc(GH.repo) + '</b>. It is kept only in this browser.<br><br>' +
  '<b>Simplest:</b> <a href="https://github.com/settings/tokens/new?scopes=public_repo&description=Portfolio%20site" target="_blank" rel="noopener" style="text-decoration:underline">make a classic token</a> ' +
  '(the “public_repo” box is pre-ticked — just pick an expiry and click Generate).<br>' +
  '<b>Or, tighter:</b> a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="text-decoration:underline">fine-grained token</a> ' +
  'with only this repository and Contents: Read and write.';

async function login() {
  let problem = '';
  for (;;) {
    const t = await ask('Owner login', '', 'password',
      (problem ? `<span style="color:#000"><b>${esc(problem)}</b></span><br><br>` : '') + TOKEN_HELP);
    if (t === null) return;
    token = t.trim();
    problem = await ghTokenProblem();
    if (!problem) {
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
  if (file.size > MAX_UPLOAD) { toast('That file is over 25 MB (GitHub’s upload limit). For big videos use “+ Video link” with YouTube or Vimeo.', 8000); return null; }
  const name = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + uid() + UPLOAD_TYPES[file.type];
  let r = null;
  try {
    const b64 = await blobToB64(file);
    r = await queued(() => ghPut('uploads/' + name, b64, `Upload ${file.name}`));
  } catch { /* offline */ }
  if (!r || !r.ok) { await ghFailed(r); return null; }
  const url = '/uploads/' + name;
  localPreview.set(url, URL.createObjectURL(file));
  let variants = null;
  const copies = await makeCopies(file);
  if (copies) {
    const base = name.replace(/\.\w+$/, '');
    for (const c of copies.list) {
      const path = `uploads/sized/${base}-${c.size}.${c.ext}`;
      let rr = null;
      try { rr = await queued(async () => ghPut(path, await blobToB64(c.blob), `Upload ${file.name} (${c.size}px copy)`)); } catch { /* offline */ }
      if (rr && rr.ok) (variants = variants || { w: copies.w })[c.size] = '/' + path;
    }
  }
  toast('Uploaded — remember to Save');
  return { url, variants };
}

async function askVideoLink(title) {
  for (let hint = 'Paste a link to the video on YouTube or Vimeo — any length or size. ' +
       'Tip: on YouTube, set it to “Unlisted” if you only want it seen on your site.';;) {
    const url = await ask(title, '', 'text', hint);
    if (url === null || !url.trim()) return null;
    const v = parseVideoLink(url);
    if (v) return v;
    hint = '<b>That doesn’t look like a YouTube or Vimeo link.</b> Copy the address from the video’s page (or its Share button) and try again.';
  }
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
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {      // select every block on the grid in view
    const boardEl = mainBoard();
    if (boardEl) { e.preventDefault(); selectAll(boardEl); }
    return;
  }
  const sels = $$('.item.sel');
  if (!sels.length) return;
  const boardEl = sels[0].closest('.board');
  const its = sels.map(x => findItem(boardEl, x.dataset.id)).filter(Boolean);
  if (e.key === 'Escape') { select(null); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelected(boardEl); return; }
  if (e.key === 'Enter' && its.length === 1 && its[0].type === 'text') { e.preventDefault(); editText(sels[0], boardEl); return; }
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!d) return;
  e.preventDefault();
  if (e.shiftKey) {                                                      // resize: one block at a time
    if (its.length !== 1) return;
    const it = its[0];
    it.w = clamp(it.w + d[0], 1, COLS - it.x); it.h = Math.max(1, it.h + d[1]);
  } else {                                                               // move the whole group if it fits
    if (!its.every(it => it.x + d[0] >= 0 && it.x + it.w + d[0] <= COLS && it.y + d[1] >= 0)) return;
    its.forEach(it => { it.x += d[0]; it.y += d[1]; });
  }
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

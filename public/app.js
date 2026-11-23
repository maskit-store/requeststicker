/* Sistem Request Cetak Sticker — single page app (no build step) */
'use strict';

// ---------------- utilities ----------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = n => Number(n || 0).toLocaleString('id-ID');
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
function fmtDate(s, time = false) {
  if (!s) return '-';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s.replace(' ', 'T') + (/[zZ+]/.test(s.slice(10)) ? '' : 'Z'));
  if (isNaN(d)) return s;
  const o = { day: '2-digit', month: 'short', year: 'numeric' };
  if (time) Object.assign(o, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('id-ID', o);
}
const thumbUrl = (id, sz = 600) => id ? `/api/thumb/${encodeURIComponent(id)}?sz=${sz}` : '';
const bgThumb = (id, sz) => id ? `style="background-image:url('${thumbUrl(id, sz)}')"` : '';
const ICON = {
  ruler: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2m1-5 2 2m1-5 2 2"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  drive: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3h8l6 10-4 7H6l-4-7z"/><path d="M8 3 14 13H2m20 0H10l-4 7"/></svg>',
  pdf: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  logo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4" fill="#99f6e4"/></svg>',
};
const STATUS = {
  pending: 'Menunggu Persetujuan', approved: 'Disetujui', rejected: 'Ditolak', sent: 'Dikirim ke Vendor', done: 'Selesai', cancelled: 'Dibatalkan',
};
const ROLE = { admin: 'Admin', user: 'User / Tim', manager_desain: 'Manager Desain', purchasing: 'Purchasing', desainer: 'Desainer' };
const APPROVERS = ['desainer', 'manager_desain', 'purchasing'];
const badge = s => `<span class="badge ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
const PKG = { sticker: 'Sticker / Label', flexible: 'Flexible Packaging', box: 'Box / Karton', other: 'Lainnya' };
const PKG_SHORT = { sticker: 'Sticker', flexible: 'Flexible', box: 'Box', other: 'Lainnya' };
const pkgBadge = (t, short = false) => t ? `<span class="pkg ${esc(t)}" title="${esc(PKG[t] || t)}">${esc((short ? PKG_SHORT : PKG)[t] || t)}</span>` : '';

async function api(path, opts = {}) {
  const o = { method: 'GET', headers: {}, ...opts };
  if (o.body && !(o.body instanceof Blob) && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, o);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { state.user = null; render(); }
  if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
  return data;
}
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = 'toast'), 3800);
}
async function busy(btn, fn) {
  const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + html;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.innerHTML = html; }
}
function modal(title, body, { wide = false, foot = '' } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${title}</h2><button class="btn ghost sm" data-close aria-label="Tutup">✕</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  return { el: bg, close };
}
function lightbox(fileId, caption = '') {
  modal(esc(caption || 'Pratinjau sticker'), `<div class="lightbox"><img src="${thumbUrl(fileId, 1600)}" alt="${esc(caption)}"></div>
    <div class="row"><a class="btn sm" target="_blank" rel="noopener" href="https://drive.google.com/file/d/${esc(fileId)}/view">${ICON.drive} Buka di Google Drive</a></div>`, { wide: true });
}
document.addEventListener('click', e => {
  const z = e.target.closest('[data-zoom]');
  if (z) { e.preventDefault(); e.stopPropagation(); lightbox(z.dataset.zoom, z.dataset.caption); }
});

// signature pad
function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, dirty = false, last = null;
  const fit = () => {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1f4d';
  };
  fit();
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
    last = p; dirty = true;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    isEmpty: () => !dirty,
    load(dataUrl) {
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => { const r = canvas.getBoundingClientRect(); const s = Math.min(r.width / img.width, r.height / img.height); ctx.drawImage(img, (r.width - img.width * s) / 2, (r.height - img.height * s) / 2, img.width * s, img.height * s); dirty = true; };
      img.src = dataUrl;
    },
    toDataURL() {
      // trim to the drawn area
      const { width, height } = canvas, d = ctx.getImageData(0, 0, width, height).data;
      let x0 = width, y0 = height, x1 = 0, y1 = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (d[(y * width + x) * 4 + 3]) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
      if (x1 <= x0) return '';
      const pad = 8, c = document.createElement('canvas');
      c.width = x1 - x0 + pad * 2; c.height = y1 - y0 + pad * 2;
      c.getContext('2d').drawImage(canvas, x0 - pad, y0 - pad, c.width, c.height, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    },
  };
}

// ---------------- state & routing ----------------
const state = { user: undefined, suppliers: [], brands: null, stats: null };
const ROUTES = {
  '': { title: 'Beranda', view: viewHome },
  'baru': { title: 'Buat Request', view: viewNewRequest },
  'request': { title: 'Daftar Request', view: viewRequests },
  'persetujuan': { title: 'Persetujuan', view: viewApprovals, roles: APPROVERS },
  'generator': { title: 'Generator Batch & Exp', view: viewGenerator, roles: ['admin'] },
  'katalog': { title: 'Katalog Sticker', view: viewCatalog },
  'laporan': { title: 'Laporan PDF', view: viewReports, roles: ['admin', ...APPROVERS] },
  'pengguna': { title: 'Pengguna', view: viewUsers, roles: ['admin'] },
  'profil': { title: 'Profil & Tanda Tangan', view: viewProfile },
  'kop': { title: 'Kop Surat & Purchase Request', view: viewCompany, roles: ['admin'] },
};
const route = () => location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
window.addEventListener('hashchange', () => {
  for (const m of $$('.modal-bg')) m.parentNode.removeChild(m); // close open dialogs when navigating
  render();
});

async function boot() {
  try { const me = await api('/api/me'); state.user = me.user; state.suppliers = me.suppliers; }
  catch { state.user = null; }
  render();
}

async function render() {
  const app = $('#app');
  if (!state.user) return renderLogin(app);
  const [name, ...rest] = route();
  const r = ROUTES[name] || ROUTES[''];
  if (r.roles && !r.roles.includes(state.user.role)) { location.hash = '#/'; return; }
  if (!$('.shell', app)) renderShell(app);
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.r === (ROUTES[name] ? name : '')));
  $('.side').classList.remove('open');
  document.title = `${r.title} · Request Cetak Sticker`;
  const main = $('.main');
  main.innerHTML = '<div class="muted">Memuat…</div>';
  try { await r.view(main, rest); } catch (e) { main.innerHTML = `<div class="callout err">${esc(e.message)}</div>`; }
  refreshCounts();
}

function renderShell(app) {
  const u = state.user;
  const links = [
    ['', 'Beranda'], ['baru', 'Buat Request'], ['request', u.role === 'user' ? 'Request Saya' : 'Semua Request'],
    ...(APPROVERS.includes(u.role) ? [['persetujuan', 'Persetujuan <span class="count hidden" id="cnt-ap"></span>']] : []),
    ...(u.role === 'admin' ? [['generator', 'Generator Batch & Exp']] : []),
    ['katalog', u.role === 'admin' ? 'Kelola Katalog' : 'Katalog Sticker'],
    ...(u.role === 'admin' || APPROVERS.includes(u.role) ? [['laporan', 'Laporan PDF']] : []),
    ...(u.role === 'admin' ? [['pengguna', 'Pengguna']] : []),
    ...(u.role === 'admin' ? [['kop', 'Kop Surat & PR']] : []),
    ['profil', 'Profil & TTD'],
  ];
  app.innerHTML = `<div class="topbar"><button aria-label="Menu" id="menu">☰</button><b>Request Cetak Sticker</b></div>
  <div class="shell">
    <aside class="side">
      <div class="brand"><span class="logo">${ICON.logo}</span><span>Request Cetak<small>Sticker Kemasan</small></span></div>
      <nav class="nav">${links.map(([r, t]) => `<a href="#/${r}" data-r="${r}">${t}</a>`).join('')}</nav>
      <div class="who"><b>${esc(u.name)}</b>${esc(ROLE[u.role])}${u.division ? ' · ' + esc(u.division) : ''}<br><button id="logout">Keluar</button></div>
    </aside>
    <main class="main"></main>
  </div>`;
  $('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); state.user = null; state.brands = null; location.hash = '#/'; render(); };
  $('#menu').onclick = () => $('.side').classList.toggle('open');
}
async function refreshCounts() {
  try {
    state.stats = await api('/api/stats');
    const c = $('#cnt-ap');
    if (c) { c.textContent = state.stats.awaiting_me; c.classList.toggle('hidden', !state.stats.awaiting_me); }
  } catch {}
}

function renderLogin(app) {
  app.innerHTML = `<div class="login">
    <div class="art">
      <div class="brand" style="padding:0"><span class="logo">${ICON.logo}</span><span>Request Cetak<small>Sticker Kemasan</small></span></div>
      <div><h1>Request cetak sticker kemasan, rapi dari permintaan sampai vendor.</h1>
      <p>Pilih sticker langsung dari database Google Drive, lihat visual & ukurannya, lalu ajukan. Ringkasan PDF siap diteruskan ke vendor setelah disetujui.</p></div>
      <div class="flow"><div><b>1</b>Tim memilih sticker, variasi, jumlah & supplier</div><div><b>2</b>Admin mengisi nomor batch & expired — file cetak otomatis dibuat</div>
      <div><b>3</b>Desainer, Manager Desain & Purchasing ACC + tanda tangan</div><div><b>4</b>Admin unduh ringkasan PDF & teruskan ke vendor</div></div>
    </div>
    <form id="lf">
      <h1>Masuk</h1>
      <label class="f">Username<input class="input" name="username" autocomplete="username" required autofocus></label>
      <label class="f">Password<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary lg">Masuk</button>
      <p class="muted small">Belum punya akun? Hubungi admin.</p>
    </form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await busy(e.submitter, async () => {
      const r = await api('/api/login', { method: 'POST', body: Object.fromEntries(fd) });
      state.user = r.user;
      const me = await api('/api/me'); state.suppliers = me.suppliers;
      app.innerHTML = ''; render();
    });
  };
}

async function getBrands(force) {
  if (!state.brands || force) state.brands = await api('/api/brands');
  return state.brands;
}

// ---------------- home ----------------
async function viewHome(main) {
  const [stats, reqs] = await Promise.all([api('/api/stats'), api('/api/requests?limit=8')]);
  const s = stats.byStatus || {};
  const u = state.user;
  main.innerHTML = `
  <div class="page-head"><div><h1>Halo, ${esc(u.name)}</h1><p>${esc(ROLE[u.role])} · ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
    <a class="btn primary lg" href="#/baru">+ Buat Request Cetak</a></div>
  ${stats.awaiting_me ? `<div class="callout warn" style="margin-bottom:16px"><b>${stats.awaiting_me} request</b> menunggu ACC & tanda tangan Anda. <a href="#/persetujuan">Tinjau sekarang →</a></div>` : ''}
  <div class="grid4" style="margin-bottom:18px">
    ${[['pending', 'Menunggu persetujuan'], ['approved', 'Disetujui, siap ke vendor'], ['sent', 'Dikirim ke vendor'], ['done', 'Selesai']]
      .map(([k, l]) => `<a class="card stat" style="text-decoration:none;color:inherit" href="#/request?status=${k}"><div class="n">${fmtNum(s[k] || 0)}</div><div class="l">${l}</div></a>`).join('')}
  </div>
  <div class="card">
    <div class="card-head"><h2>Request terbaru</h2><a href="#/request" class="small">Lihat semua →</a></div>
    ${requestTable(reqs)}
  </div>
  <p class="muted small" style="margin-top:14px">Katalog: ${fmtNum(stats.brands)} brand · ${fmtNum(stats.products)} produk · ${fmtNum(stats.variants)} file sticker.</p>`;
  bindRequestRows(main);
}

function requestTable(rows, { showRequester = true } = {}) {
  if (!rows.length) return '<div class="empty">Belum ada request.</div>';
  return `<div class="table-wrap"><table class="t"><thead><tr><th>No. Request</th><th>Tanggal</th>${showRequester ? '<th>Pemohon</th>' : ''}<th>Isi</th><th>Supplier</th><th>Persetujuan</th><th>Status</th></tr></thead><tbody>
  ${rows.map(r => {
    const ap = Object.fromEntries((r.approval_summary || '').split(',').filter(Boolean).map(x => x.split(':')));
    return `<tr class="click" data-id="${r.id}">
      <td><b class="mono">${esc(r.number)}</b></td><td>${fmtDate(r.request_date)}</td>
      ${showRequester ? `<td>${esc(r.requester_name)}<div class="muted small">${esc(r.division || '')}</div></td>` : ''}
      <td>${fmtNum(r.item_count)} item · ${fmtNum(r.total_qty)} pcs<div class="muted small">${esc((r.brands || '').replace(/,/g, ', '))}</div></td>
      <td class="small">${esc((r.suppliers || '').replace(/,/g, ', '))}</td>
      <td class="small">${APPROVERS.map(a => `<span title="${ROLE[a]}" style="margin-right:6px">${ap[a] === 'approved' ? '✅' : ap[a] === 'rejected' ? '⛔' : '⬜'} ${ROLE[a].split(' ')[0]}</span>`).join('')}</td>
      <td>${badge(r.status)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function bindRequestRows(root) {
  $$('tr[data-id]', root).forEach(tr => tr.onclick = () => openRequest(tr.dataset.id));
}

// ---------------- sticker picker (shared) ----------------
/**
 * Renders brand chips → search → product grid → variant cards into `root`.
 * Calls onPick({product, variant}) whenever the selected variant changes.
 */
async function stickerPicker(root, onPick) {
  const brands = await getBrands();
  const st = { brand: '', q: '', product: null, variant: null, timer: null, seq: 0 };
  root.innerHTML = `
    <div class="step"><span class="num">1</span><h3>Pilih brand</h3></div>
    <div class="chips" id="pk-brands">
      <button class="chip on" data-b="">Semua</button>
      ${brands.filter(b => b.product_count > 0).map(b => `<button class="chip" data-b="${b.id}">${esc(b.name)}<small>${b.product_count}</small></button>`).join('')}
    </div>
    <div class="row" id="pk-types"><span class="small muted">Jenis desain:</span>
      <button class="chip on" data-t="">Semua</button>${Object.entries(PKG).filter(([k]) => k !== 'other').map(([k, v]) => `<button class="chip" data-t="${k}">${v}</button>`).join('')}</div>
    <div class="step"><span class="num">2</span><h3>Cari nama sticker / kemasan</h3></div>
    <div class="search">${ICON.search}<input class="input" id="pk-q" placeholder="Ketik nama produk atau kode, mis. “baby wash”, “M141”, “abon”…" autocomplete="off"></div>
    <div class="results" id="pk-results"></div>
    <div id="pk-variants"></div>`;
  const resultsEl = $('#pk-results', root), varEl = $('#pk-variants', root);

  async function load() {
    const my = ++st.seq;
    resultsEl.innerHTML = '<div class="muted small">Mencari…</div>';
    const params = new URLSearchParams({ limit: 80 });
    if (st.brand) params.set('brand_id', st.brand);
    if (st.q) params.set('q', st.q);
    if (st.type) params.set('package_type', st.type);
    const rows = await api('/api/products?' + params);
    if (my !== st.seq) return;
    resultsEl.innerHTML = rows.length ? rows.map(p => `
      <button class="pcard ${st.product?.id === p.id ? 'on' : ''}" data-p="${p.id}" type="button">
        <div class="img" ${bgThumb(p.thumb_file_id, 300)}><span class="pkgs">${(p.package_types || '').split(',').filter(Boolean).map(t => pkgBadge(t, true)).join('')}</span></div>
        <div class="b"><span class="code">${esc(p.code || p.brand_name)}</span><span class="nm">${esc(p.name)}</span>
        <span class="sz">${esc((p.dimensions || '').split(' | ').slice(0, 2).join(' · ') || '—')}${p.variant_count > 1 ? ` · ${p.variant_count} variasi` : ''}</span></div>
      </button>`).join('') : '<div class="muted small">Tidak ada sticker yang cocok. Coba kata kunci lain atau pilih brand lain.</div>';
  }
  async function showProduct(id) {
    const p = await api('/api/products/' + id);
    st.product = p; st.variant = p.variants.length === 1 ? p.variants[0] : null;
    $$('.pcard', resultsEl).forEach(c => c.classList.toggle('on', +c.dataset.p === p.id));
    varEl.innerHTML = `
      <div class="step" style="margin-top:6px"><span class="num">3</span><h3>Pilih variasi — cek visual & ukuran</h3></div>
      <div class="muted small" style="margin:4px 0 10px">${esc(p.brand_name)} · <b>${esc(p.code ? p.code + '. ' : '')}${esc(p.name)}</b>
        ${p.drive_link ? ` · <a href="${esc(p.drive_link)}" target="_blank" rel="noopener">folder Drive</a>` : ''}${p.description ? `<br>${esc(p.description)}` : ''}</div>
      <div class="variants">${p.variants.map(v => `
        <div class="vcard ${st.variant?.id === v.id ? 'on' : ''}" data-v="${v.id}" role="button" tabindex="0">
          <div class="img" ${bgThumb(v.drive_file_id, 600)}>${v.drive_file_id ? `<button class="zoom" type="button" data-zoom="${esc(v.drive_file_id)}" data-caption="${esc(v.name)}">Perbesar</button>` : ''}</div>
          <div class="info">
            <div class="row"><span class="radio"></span>${pkgBadge(v.package_type)}</div>
            <b>${esc(v.name)}</b>
            <div class="row">${v.dimension ? `<span class="dim">${ICON.ruler} ${esc(v.dimension)}</span>` : '<span class="badge pending">Ukuran belum tercatat</span>'}
              ${v.volume ? `<span class="badge">${esc(v.volume)}</span>` : ''}${v.tags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>
            <div class="fname">${ICON.pdf} ${esc(v.file_name || '-')}</div>
            ${v.drive_link ? `<div><a class="small" href="${esc(v.drive_link)}" target="_blank" rel="noopener">${ICON.drive} Buka file mentah</a></div>` : ''}
          </div>
        </div>`).join('') || '<div class="callout warn">Produk ini belum memiliki file sticker.</div>'}</div>`;
    $$('.vcard', varEl).forEach(c => {
      const pick = () => { st.variant = p.variants.find(v => v.id === +c.dataset.v); $$('.vcard', varEl).forEach(x => x.classList.toggle('on', x === c)); onPick({ product: p, variant: st.variant }); };
      c.onclick = pick; c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    });
    onPick({ product: p, variant: st.variant });
  }
  $('#pk-types', root).onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    st.type = c.dataset.t; $$('#pk-types .chip', root).forEach(x => x.classList.toggle('on', x === c)); load();
  };
  $('#pk-brands', root).onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    st.brand = c.dataset.b; $$('#pk-brands .chip', root).forEach(x => x.classList.toggle('on', x === c)); load();
  };
  $('#pk-q', root).oninput = e => { clearTimeout(st.timer); st.timer = setTimeout(() => { st.q = e.target.value.trim(); load(); }, 220); };
  resultsEl.onclick = e => { const c = e.target.closest('.pcard'); if (c) showProduct(c.dataset.p).catch(err => toast(err.message, true)); };
  await load();
  return {
    reset() { st.product = null; st.variant = null; varEl.innerHTML = ''; $$('.pcard', resultsEl).forEach(c => c.classList.remove('on')); onPick({}); },
  };
}

// ---------------- new request ----------------
async function viewNewRequest(main) {
  const u = state.user;
  const cart = [];
  let sel = {};
  main.innerHTML = `
  <div class="page-head"><div><h1>Buat Request Cetak Sticker</h1><p>Pilih sticker dari database, cek visual & ukurannya, lalu tambahkan ke daftar.</p></div></div>
  <div class="split">
    <div class="stack">
      <div class="card card-pad stack" id="picker"></div>
      <div class="card card-pad stack" id="item-form">
        <div class="step"><span class="num">4</span><h3>Jumlah & supplier</h3></div>
        <div id="sel-summary" class="callout">Belum ada sticker dipilih.</div>
        <div class="grid3">
          <label class="f">Jumlah cetak (pcs)<input class="input" id="qty" type="number" min="1" step="1" placeholder="mis. 1000"></label>
          <label class="f">Supplier sticker<select class="input" id="supplier"><option value="">— Pilih supplier —</option>${state.suppliers.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
          <label class="f hidden" id="sup-other-wrap">Nama supplier lainnya<input class="input" id="sup-other" placeholder="Nama vendor"></label>
        </div>
        <label class="f">Catatan item <span class="hint">(opsional)</span><input class="input" id="item-note" placeholder="mis. bahan transparan, finishing glossy"></label>
        <div><button class="btn primary" id="add" disabled>+ Tambahkan ke daftar request</button></div>
      </div>
    </div>
    <div class="stack sticky">
      <div class="card">
        <div class="card-head"><h2>Daftar request <span class="muted" id="cart-count"></span></h2></div>
        <div id="cart"></div>
      </div>
      <form class="card card-pad stack" id="req-form">
        <h2>Detail request</h2>
        <div class="grid2">
          <label class="f">Nama pemohon<input class="input" name="requester_name" value="${esc(u.name)}" required></label>
          <label class="f">Divisi / tim<input class="input" name="division" value="${esc(u.division || '')}"></label>
          <label class="f">Tanggal request<input class="input" type="date" name="request_date" value="${todayStr()}" required></label>
          <label class="f">Dibutuhkan tanggal <span class="hint">(opsional)</span><input class="input" type="date" name="needed_date"></label>
        </div>
        <label class="f">Catatan untuk admin <span class="hint">(opsional)</span><textarea class="input" name="notes"></textarea></label>
        <button class="btn primary lg" id="submit" disabled>Kirim Request</button>
      </form>
    </div>
  </div>`;
  const picker = await stickerPicker($('#picker'), s => { sel = s; refreshSel(); });
  const supplier = $('#supplier');
  supplier.onchange = () => { $('#sup-other-wrap').classList.toggle('hidden', supplier.value !== 'Lainnya'); refreshSel(); };
  $('#qty').oninput = refreshSel;
  function refreshSel() {
    const v = sel.variant, p = sel.product;
    $('#sel-summary').innerHTML = v ? `<div class="row"><span class="thumb" ${bgThumb(v.drive_file_id, 300)} data-zoom="${esc(v.drive_file_id)}" data-caption="${esc(v.name)}"></span>
      <div><b>${esc(p.brand_name)} · ${esc(p.code ? p.code + '. ' : '')}${esc(p.name)}</b><div class="small">${esc(v.name)}</div>
      <div class="row" style="margin-top:4px">${pkgBadge(v.package_type)}${v.dimension ? `<span class="dim">${ICON.ruler} ${esc(v.dimension)}</span>` : ''}${v.volume ? `<span class="badge">${esc(v.volume)}</span>` : ''}</div></div></div>`
      : p ? 'Pilih salah satu variasi di atas.' : 'Belum ada sticker dipilih.';
    $('#add').disabled = !(v && +$('#qty').value > 0 && supplier.value && (supplier.value !== 'Lainnya' || $('#sup-other').value.trim()));
  }
  $('#sup-other').oninput = refreshSel;
  $('#add').onclick = () => {
    const v = sel.variant, p = sel.product;
    cart.push({ variant_id: v.id, qty: +$('#qty').value, supplier: supplier.value, supplier_other: $('#sup-other').value.trim(), notes: $('#item-note').value.trim(),
      _v: v, _p: p });
    $('#qty').value = ''; $('#item-note').value = '';
    picker.reset(); renderCart(); toast('Ditambahkan ke daftar request');
    $('#cart').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  function renderCart() {
    $('#cart-count').textContent = cart.length ? `(${cart.length})` : '';
    $('#cart').innerHTML = cart.length ? cart.map((c, i) => `
      <div class="cart-item"><span class="thumb" ${bgThumb(c._v.drive_file_id, 300)} data-zoom="${esc(c._v.drive_file_id)}" data-caption="${esc(c._v.name)}"></span>
        <div><div class="small muted">${esc(c._p.brand_name)}</div><b>${esc(c._p.code ? c._p.code + '. ' : '')}${esc(c._p.name)}</b>
          <div class="small">${pkgBadge(c._v.package_type, true)} ${esc(c._v.name)}</div>
          <div class="row small" style="margin-top:4px">${c._v.dimension ? `<span class="dim">${esc(c._v.dimension)}</span>` : ''}<b>${fmtNum(c.qty)} pcs</b> · ${esc(c.supplier === 'Lainnya' ? c.supplier_other : c.supplier)}</div>
          ${c.notes ? `<div class="small muted">${esc(c.notes)}</div>` : ''}</div>
        <button class="btn ghost sm danger" data-rm="${i}" title="Hapus">✕</button></div>`).join('')
      : '<div class="empty">Belum ada sticker. Pilih sticker di sebelah kiri lalu klik “Tambahkan”.</div>';
    $$('[data-rm]').forEach(b => b.onclick = () => { cart.splice(+b.dataset.rm, 1); renderCart(); });
    $('#submit').disabled = !cart.length;
  }
  renderCart();
  $('#req-form').onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.items = cart.map(({ _v, _p, ...rest }) => rest);
    await busy($('#submit'), async () => {
      const r = await api('/api/requests', { method: 'POST', body });
      toast(`Request ${r.number} terkirim`);
      location.hash = '#/request';
      setTimeout(() => openRequest(r.id), 300);
    });
  };
}

// ---------------- requests list ----------------
async function viewRequests(main) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  main.innerHTML = `
  <div class="page-head"><div><h1>${state.user.role === 'user' ? 'Request Saya' : 'Semua Request'}</h1><p>Klik baris untuk melihat detail, persetujuan, dan mengunduh PDF.</p></div>
    <a class="btn primary" href="#/baru">+ Buat Request</a></div>
  <div class="card">
    <div class="card-head">
      <div class="row">
        <div class="search" style="min-width:260px">${ICON.search}<input class="input" id="f-q" placeholder="Cari no. request, produk, pemohon…" value="${esc(params.get('q') || '')}"></div>
        <select class="input" id="f-status" style="width:auto"><option value="">Semua status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${params.get('status') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input class="input" type="date" id="f-from" style="width:auto" title="Dari tanggal"><input class="input" type="date" id="f-to" style="width:auto" title="Sampai tanggal">
      </div>
    </div>
    <div id="list"></div>
  </div>`;
  let t;
  const load = async () => {
    const p = new URLSearchParams();
    for (const [k, id] of [['q', 'f-q'], ['status', 'f-status'], ['from', 'f-from'], ['to', 'f-to']]) if ($('#' + id).value) p.set(k, $('#' + id).value);
    const rows = await api('/api/requests?' + p);
    $('#list').innerHTML = requestTable(rows, { showRequester: state.user.role !== 'user' });
    bindRequestRows($('#list'));
  };
  ['f-status', 'f-from', 'f-to'].forEach(id => $('#' + id).onchange = load);
  $('#f-q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  await load();
}

async function viewApprovals(main) {
  const [awaiting, all] = await Promise.all([api('/api/requests?awaiting=1'), api('/api/requests?limit=30')]);
  main.innerHTML = `
  <div class="page-head"><div><h1>Persetujuan</h1><p>Request yang perlu Anda ACC dan tanda tangani sebagai <b>${esc(ROLE[state.user.role])}</b>.</p></div></div>
  <div class="card" style="margin-bottom:18px"><div class="card-head"><h2>Menunggu tanda tangan Anda (${awaiting.length})</h2></div><div id="aw">${requestTable(awaiting)}</div></div>
  <div class="card"><div class="card-head"><h2>Riwayat terbaru</h2></div><div id="hist">${requestTable(all)}</div></div>`;
  bindRequestRows(main);
}

// ---------------- request detail ----------------
async function openRequest(id) {
  const m = modal('Memuat…', '<div class="muted">Memuat…</div>', { wide: true });
  const reload = async () => {
    const r = await api('/api/requests/' + id);
    renderRequestModal(m, r, reload);
  };
  try { await reload(); } catch (e) { m.close(); toast(e.message, true); }
}

function renderRequestModal(m, r, reload) {
  const u = state.user;
  const isAdmin = u.role === 'admin';
  const mine = r.approvals.find(a => a.role === u.role);
  const canSign = APPROVERS.includes(u.role) && (r.status === 'pending' || r.status === 'rejected');
  const suppliers = [...new Set(r.items.map(i => i.supplier))];
  const editable = !['sent', 'done', 'cancelled'].includes(r.status);
  const canPR = ['admin', 'purchasing'].includes(u.role);
  $('.modal-head h2', m.el).innerHTML = `${esc(r.number)} ${badge(r.status)}`;
  $('.modal-body', m.el).innerHTML = `
    <dl class="kv">
      <dt>Pemohon</dt><dd>${esc(r.requester_name)}${r.division ? ` · ${esc(r.division)}` : ''}</dd>
      <dt>Tanggal request</dt><dd>${fmtDate(r.request_date)}</dd>
      ${r.needed_date ? `<dt>Dibutuhkan</dt><dd>${fmtDate(r.needed_date)}</dd>` : ''}
      ${r.notes ? `<dt>Catatan</dt><dd style="font-weight:400">${esc(r.notes)}</dd>` : ''}
      ${r.status_note ? `<dt>Catatan status</dt><dd style="font-weight:400">${esc(r.status_note)}</dd>` : ''}
    </dl>
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th></th><th>Sticker</th><th>Ukuran</th><th>Jumlah</th><th>Supplier</th><th>Batch / Exp</th>${isAdmin && editable ? '<th></th>' : ''}</tr></thead><tbody>
    ${r.items.map(it => `<tr>
      <td><span class="thumb lg" ${bgThumb(it.drive_file_id, 300)} data-zoom="${esc(it.drive_file_id)}" data-caption="${esc(it.variant_name)}"></span></td>
      <td><div class="small muted">${esc(it.brand)} ${pkgBadge(it.package_type)}</div><b>${esc(it.product_code ? it.product_code + '. ' : '')}${esc(it.product_name)}</b><div class="small">${esc(it.variant_name)}${it.volume ? ' · ' + esc(it.volume) : ''}</div>
        ${it.notes ? `<div class="small muted">Catatan: ${esc(it.notes)}</div>` : ''}
        <div class="row small" style="margin-top:4px">${it.drive_link ? `<a href="${esc(it.drive_link)}" target="_blank" rel="noopener">${ICON.drive} File mentah</a>` : ''}
        ${it.generated_uuid ? `<a href="/files/${esc(it.generated_uuid)}/${encodeURIComponent(it.generated_name)}" target="_blank" rel="noopener"><b>${ICON.pdf} File siap cetak</b></a>` : ''}</div></td>
      <td>${it.dimension ? `<span class="dim">${esc(it.dimension)}</span>` : '-'}</td>
      <td><b>${fmtNum(it.qty)}</b> pcs</td><td>${esc(it.supplier)}</td>
      <td class="mono small" style="white-space:nowrap">${it.batch_number || it.exp_code ? `BN ${esc(it.batch_number || '-')}<br>EXP ${esc(it.exp_code || '-')}` : '<span class="muted" style="font-family:inherit">Belum diisi</span>'}</td>
      ${isAdmin && editable ? `<td><button class="btn sm primary" data-gen="${it.id}">${it.generated_uuid ? 'Ubah' : 'Isi'} Batch/Exp</button></td>` : ''}
    </tr>`).join('')}</tbody></table></div></div>
    <div><h3 style="margin-bottom:8px">Persetujuan & tanda tangan</h3>
      <div class="approvals">${APPROVERS.map(role => {
        const a = r.approvals.find(x => x.role === role);
        return `<div class="ap ${a ? a.decision : ''}"><div class="role">${ROLE[role]}</div>
          <div style="display:grid;place-items:center">${a?.decision === 'approved' && a.signature ? `<img src="${a.signature}" alt="Tanda tangan ${esc(a.user_name)}">`
            : a?.decision === 'rejected' ? `<div style="color:var(--danger);font-weight:700">DITOLAK</div><div class="small">${esc(a.note)}</div>` : '<span class="muted small">Belum ditandatangani</span>'}</div>
          <div class="nm">${a ? esc(a.user_name) : '—'}<div class="small muted" style="font-weight:400">${a ? fmtDate(a.signed_at, true) : ''}${a?.decision === 'approved' && a.note ? ' · ' + esc(a.note) : ''}</div></div></div>`;
      }).join('')}</div>
    </div>
    ${r.status === 'approved' && isAdmin ? '<div class="callout ok">Semua pihak sudah ACC & tanda tangan. Buat <b>Purchase Request</b> untuk tiap vendor di bawah, kirimkan ke vendor, lalu tandai “Dikirim ke Vendor”.</div>' : ''}
    ${canPR ? `<div class="card card-pad stack">
      <div class="row between"><h3>Purchase Request ke vendor</h3>
        ${['approved', 'sent', 'done'].includes(r.status) ? `<div class="row">${suppliers.map(sp => `<button class="btn sm primary" data-pr="${esc(sp)}">+ PR ${esc(sp.replace(/^Lainnya:\s*/, ''))}</button>`).join('')}</div>`
          : '<span class="small muted">Tersedia setelah request disetujui 3 pihak.</span>'}</div>
      ${r.purchase_requests.length ? `<div class="table-wrap"><table class="t"><tbody>${r.purchase_requests.map(p => `<tr>
        <td><b class="mono">${esc(p.number)}</b><div class="small muted">${fmtDate(p.pr_date)} · dibuat ${esc(p.created_by_name)}</div></td>
        <td>${esc(p.vendor_name)}</td>
        <td style="text-align:right"><a class="btn sm" href="/api/purchase-requests/${p.id}/pdf" target="_blank" rel="noopener">${ICON.pdf} Lihat PDF</a>
          <a class="btn sm" href="/api/purchase-requests/${p.id}/pdf?download=1">Download</a></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="small muted">Belum ada Purchase Request.</div>'}
    </div>` : ''}
    ${r.status === 'pending' && isAdmin && r.items.some(i => !i.generated_uuid) ? '<div class="callout warn">Isi nomor batch & kode expired untuk setiap sticker agar file siap cetak otomatis dibuat dan ikut tercantum di ringkasan PDF.</div>' : ''}`;
  const foot = [];
  foot.push(`<a class="btn" href="/api/requests/${r.id}/pdf" target="_blank" rel="noopener">${ICON.pdf} Ringkasan PDF</a>`);
  if (suppliers.length > 1) foot.push(`<select class="input" id="pdf-sup" style="width:auto"><option value="">PDF per supplier…</option>${suppliers.map(s => `<option>${esc(s)}</option>`).join('')}</select>`);
  if (canSign) foot.push(`<button class="btn danger" id="rej">Tolak</button><button class="btn primary" id="sign">${mine ? 'Ubah' : 'ACC &'} Tanda Tangan</button>`);
  if (isAdmin && r.status === 'approved') foot.push('<button class="btn primary" data-st="sent">Tandai Dikirim ke Vendor</button>');
  if (isAdmin && r.status === 'sent') foot.push('<button class="btn primary" data-st="done">Tandai Selesai</button>');
  if (isAdmin && ['rejected', 'approved'].includes(r.status)) foot.push('<button class="btn" id="reopen">Ajukan Ulang Persetujuan</button>');
  if ((isAdmin || r.requester_id === u.id) && r.status === 'pending') foot.push('<button class="btn danger" id="cancel">Batalkan Request</button>');
  let footEl = $('.modal-foot', m.el);
  if (!footEl) { footEl = document.createElement('div'); footEl.className = 'modal-foot'; $('.modal', m.el).appendChild(footEl); }
  footEl.style.flexWrap = 'wrap';
  footEl.innerHTML = foot.join('');

  $('#pdf-sup', m.el)?.addEventListener('change', e => { if (e.target.value) window.open(`/api/requests/${r.id}/pdf?supplier=${encodeURIComponent(e.target.value)}`, '_blank'); e.target.value = ''; });
  $$('[data-gen]', m.el).forEach(b => b.onclick = () => {
    const it = r.items.find(x => x.id === +b.dataset.gen);
    if (!it.variant_id) return toast('Sticker asli sudah tidak ada di katalog.', true);
    openGenerator({ variantId: it.variant_id, title: `${it.product_code ? it.product_code + '. ' : ''}${it.product_name} — ${it.variant_name}`, itemId: it.id, batch: it.batch_number, exp: it.exp_code, onDone: reload });
  });
  $('#sign', m.el)?.addEventListener('click', () => openSign(r, reload));
  $$('[data-pr]', m.el).forEach(b => b.onclick = () => openPurchaseRequest(r, b.dataset.pr, reload));
  $('#rej', m.el)?.addEventListener('click', () => openReject(r, reload));
  $$('[data-st]', footEl).forEach(b => b.onclick = () => busy(b, async () => {
    const note = b.dataset.st === 'sent' ? prompt('Catatan pengiriman ke vendor (opsional):', '') : '';
    if (note === null) return;
    await api(`/api/requests/${r.id}/status`, { method: 'POST', body: { status: b.dataset.st, note } });
    toast('Status diperbarui'); await reload(); refreshList();
  }));
  $('#reopen', m.el)?.addEventListener('click', e => { if (confirm('Hapus semua tanda tangan dan ajukan ulang persetujuan?')) busy(e.target, async () => { await api(`/api/requests/${r.id}/reopen`, { method: 'POST' }); await reload(); refreshList(); }); });
  $('#cancel', m.el)?.addEventListener('click', e => { if (confirm('Batalkan request ini?')) busy(e.target, async () => { await api(`/api/requests/${r.id}/cancel`, { method: 'POST' }); await reload(); refreshList(); }); });
}
function refreshList() {
  const n = route()[0];
  if (['request', 'persetujuan', ''].includes(n)) ROUTES[n].view($('.main')).then(refreshCounts).catch(() => {});
}

async function openSign(r, reload) {
  const saved = (await api('/api/me/signature')).signature;
  const m = modal(`ACC & tanda tangan — ${esc(ROLE[state.user.role])}`, `
    <p class="muted" style="margin:0">Dengan menandatangani, Anda menyetujui request <b>${esc(r.number)}</b> (${r.items.length} item, ${fmtNum(r.items.reduce((a, b) => a + b.qty, 0))} pcs) untuk diteruskan ke vendor.</p>
    <canvas class="sigpad" id="pad"></canvas>
    <div class="row between"><button class="btn sm" id="clr" type="button">Hapus</button>
      <label class="row small"><input type="checkbox" id="save" ${saved ? '' : 'checked'}> Simpan sebagai tanda tangan saya</label></div>
    <label class="f">Catatan <span class="hint">(opsional)</span><input class="input" id="note"></label>`,
  { foot: '<button class="btn" data-close>Batal</button><button class="btn primary" id="ok">Setujui & Tanda Tangani</button>' });
  const pad = signaturePad($('#pad', m.el));
  if (saved) pad.load(saved);
  $('#clr', m.el).onclick = () => pad.clear();
  $('#ok', m.el).onclick = e => busy(e.target, async () => {
    if (pad.isEmpty()) throw new Error('Silakan buat tanda tangan terlebih dahulu.');
    await api(`/api/requests/${r.id}/approve`, { method: 'POST', body: { decision: 'approved', signature: pad.toDataURL(), save_signature: $('#save', m.el).checked, note: $('#note', m.el).value } });
    m.close(); toast('Request disetujui & ditandatangani'); await reload(); refreshList();
  });
}
function openReject(r, reload) {
  const m = modal('Tolak request', `<label class="f">Alasan penolakan<textarea class="input" id="note" placeholder="mis. ukuran sticker salah, jumlah terlalu banyak"></textarea></label>`,
    { foot: '<button class="btn" data-close>Batal</button><button class="btn danger" id="ok">Tolak Request</button>' });
  $('#ok', m.el).onclick = e => busy(e.target, async () => {
    await api(`/api/requests/${r.id}/approve`, { method: 'POST', body: { decision: 'rejected', note: $('#note', m.el).value } });
    m.close(); toast('Request ditolak'); await reload(); refreshList();
  });
}

// ---------------- batch / exp generator ----------------
function openGenerator({ variantId, title, itemId, batch = '', exp = '', onDone }) {
  const m = modal('Nomor Batch & Kode Expired', `
    <div><div class="muted small">Sticker</div><b>${esc(title)}</b></div>
    <div class="callout" id="g-detect"><span class="spin"></span> Membaca nomor batch & expired yang ada di file sticker…</div>
    <div class="grid2">
      <label class="f">Nomor batch baru <span class="hint">tanpa awalan “BN.”</span><input class="input mono" id="g-batch" value="${esc(batch)}" placeholder="mis. 112611A07" autocomplete="off"></label>
      <label class="f">Kode expired baru <span class="hint">tanpa awalan “EXP.”</span><input class="input mono" id="g-exp" value="${esc(exp)}" placeholder="mis. 11-2029" autocomplete="off"></label>
    </div>
    <div id="g-result"></div>`,
  { wide: true, foot: '<button class="btn" data-close>Tutup</button><button class="btn primary" id="g-go">Generate File Siap Cetak</button>' });
  api(`/api/variants/${variantId}/detect`, { method: 'POST', body: {} }).then(d => {
    const el = $('#g-detect', m.el);
    if (!d.found.length) { el.className = 'callout warn'; el.innerHTML = 'Teks batch / expired tidak terdeteksi di file ini (kemungkinan sudah di-outline atau sticker ini tidak memiliki nomor batch). Generate tetap bisa dicoba.'; return; }
    el.className = 'found';
    el.innerHTML = `<div class="muted small">Terdeteksi di file (akan diganti):</div>` + d.found.map(f => `<div class="ln"><span class="k">${f.kind === 'batch' ? 'BATCH' : 'EXPIRED'}</span>${esc(f.text)}<span class="k" style="margin-left:auto">${esc((f.font || '').replace(/^[A-Z]{6}\+/, ''))}</span></div>`).join('');
    const firstB = d.found.find(f => f.kind === 'batch'), firstE = d.found.find(f => f.kind === 'exp');
    if (firstB && !$('#g-batch', m.el).value) $('#g-batch', m.el).placeholder = 'sebelumnya: ' + firstB.value;
    if (firstE && !$('#g-exp', m.el).value) $('#g-exp', m.el).placeholder = 'sebelumnya: ' + firstE.value;
  }).catch(e => { const el = $('#g-detect', m.el); el.className = 'callout err'; el.textContent = e.message; });
  $('#g-go', m.el).onclick = e => busy(e.target, async () => {
    const r = await api(`/api/variants/${variantId}/generate`, { method: 'POST', body: { batch: $('#g-batch', m.el).value, exp: $('#g-exp', m.el).value, request_item_id: itemId } });
    $('#g-result', m.el).innerHTML = `
      <div class="callout ok"><b>File siap cetak berhasil dibuat.</b> ${r.replaced.map(x => `<br><span class="mono">${esc(x.before)}</span> → <b class="mono">${esc(x.after)}</b>${x.stroke ? ' <span class="small">(stroke dipertahankan)</span>' : ''}`).join('')}</div>
      <div class="row"><a class="btn primary" href="${esc(r.url)}?download=1">${ICON.pdf} Download PDF</a><a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">Buka di tab baru</a>
        <button class="btn" type="button" id="g-copy">Salin link</button><span class="muted small">${(r.size / 1024 / 1024).toFixed(2)} MB</span></div>
      <iframe class="preview-frame" src="${esc(r.url)}#view=FitH" title="Pratinjau PDF"></iframe>`;
    $('#g-copy', m.el).onclick = () => navigator.clipboard.writeText(r.url).then(() => toast('Link disalin'));
    toast('File siap cetak dibuat');
    onDone && onDone();
  });
}

async function viewGenerator(main) {
  let sel = {};
  main.innerHTML = `
  <div class="page-head"><div><h1>Generator Nomor Batch & Expired</h1>
    <p>Pilih sticker, masukkan nomor batch & kode expired baru — aplikasi mengganti teks di file PDF asli (font Courier New) dan menyiapkan link download.</p></div></div>
  <div class="split">
    <div class="card card-pad stack" id="picker"></div>
    <div class="stack sticky">
      <div class="card card-pad stack"><h2>Sticker terpilih</h2><div id="gsel" class="muted">Belum ada sticker dipilih.</div>
        <button class="btn primary" id="gopen" disabled>Isi Batch & Exp →</button></div>
      <div class="card"><div class="card-head"><h2>Riwayat file yang dibuat</h2></div><div id="ghist"></div></div>
      <div class="card card-pad stack"><h3>Font pengganti</h3><div id="gfont" class="small muted"></div>
        <div class="small muted">Upload file Courier New (C:\\Windows\\Fonts\\courbd.ttf untuk Bold, cour.ttf untuk Regular) agar hasil identik 100% dengan desain.</div>
        <div class="row"><label class="btn sm">Upload Courier New Bold<input type="file" accept=".ttf,.otf" data-w="bold" hidden></label>
          <label class="btn sm">Upload Courier New Regular<input type="file" accept=".ttf,.otf" data-w="regular" hidden></label></div></div>
    </div>
  </div>`;
  await stickerPicker($('#picker'), s => {
    sel = s;
    $('#gsel').innerHTML = s.variant ? `<div class="row"><span class="thumb lg" ${bgThumb(s.variant.drive_file_id, 300)} data-zoom="${esc(s.variant.drive_file_id)}"></span><div><b>${esc(s.product.code ? s.product.code + '. ' : '')}${esc(s.product.name)}</b><div class="small">${esc(s.variant.name)}</div>${s.variant.dimension ? `<span class="dim">${esc(s.variant.dimension)}</span>` : ''}</div></div>` : 'Pilih variasi sticker.';
    $('#gopen').disabled = !(s.variant && s.variant.file_type === 'pdf');
    if (s.variant && s.variant.file_type !== 'pdf') $('#gsel').insertAdjacentHTML('beforeend', '<div class="callout warn" style="margin-top:8px">Generator hanya untuk file PDF.</div>');
  });
  $('#gopen').onclick = () => openGenerator({ variantId: sel.variant.id, title: `${sel.product.code ? sel.product.code + '. ' : ''}${sel.product.name} — ${sel.variant.name}`, onDone: loadHist });
  const showFont = f => $('#gfont').innerHTML = f.isCourierNew ? `✅ Menggunakan Courier New (<span class="mono">${esc(f.bold)}</span>, <span class="mono">${esc(f.regular)}</span>)` : `Saat ini memakai <b>FreeMono</b> (mirip Courier New, gratis & bebas lisensi).`;
  api('/api/generator/font').then(showFont);
  $$('input[type=file][data-w]').forEach(inp => inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { showFont(await api('/api/generator/font?weight=' + inp.dataset.w, { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream' } })); toast('Font tersimpan'); }
    catch (e) { toast(e.message, true); }
  });
  async function loadHist() {
    const rows = await api('/api/generated');
    $('#ghist').innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><tbody>${rows.slice(0, 30).map(g => `<tr><td><b class="small">${esc(g.product_code ? g.product_code + '. ' : '')}${esc(g.product_name || g.file_name)}</b>
      <div class="mono small">BN ${esc(g.batch_number || '-')} · EXP ${esc(g.exp_code || '-')}</div><div class="muted small">${fmtDate(g.created_at, true)} · ${esc(g.created_by_name)}</div></td>
      <td><a class="btn sm" href="${esc(g.url)}?download=1">Download</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Belum ada.</div>';
  }
  loadHist();
}

// ---------------- catalog ----------------
async function viewCatalog(main) {
  const isAdmin = state.user.role === 'admin';
  const brands = await getBrands(true);
  const sync = await api('/api/sync');
  main.innerHTML = `
  <div class="page-head"><div><h1>${isAdmin ? 'Kelola Katalog Sticker' : 'Katalog Sticker'}</h1>
    <p>Sumber: database Google Drive. ${sync.last_sync ? 'Sinkron terakhir ' + fmtDate(sync.last_sync, true) : ''}</p></div>
    ${isAdmin ? '<div class="row"><button class="btn" id="sync">⟳ Sinkron dari Google Drive</button><button class="btn primary" id="addp">+ Tambah Produk Baru</button></div>' : ''}</div>
  ${isAdmin ? `<div class="callout" style="margin-bottom:16px">Sticker produk baru bisa ditambahkan dengan dua cara: <b>(1)</b> upload ke folder brand di Google Drive dengan format nama
    <span class="mono">KODE. Nama Produk</span> → klik <b>Sinkron</b>, atau <b>(2)</b> klik <b>Tambah Produk Baru</b> dan isi detail + link Google Drive-nya. Produk langsung muncul di sisi user.</div>
    <div id="sync-status"></div>` : ''}
  <div class="card">
    <div class="card-head"><div class="row">
      <select class="input" id="c-brand" style="width:auto"><option value="">Semua brand</option>${brands.map(b => `<option value="${b.id}">${esc(b.name)} (${b.product_count})</option>`).join('')}</select>
      <div class="search" style="min-width:280px">${ICON.search}<input class="input" id="c-q" placeholder="Cari produk / kode / nama file"></div>
      ${isAdmin ? '<label class="row small"><input type="checkbox" id="c-empty"> tampilkan produk tanpa file</label>' : ''}</div></div>
    <div id="c-list"></div>
  </div>`;
  let t;
  const load = async () => {
    const p = new URLSearchParams({ limit: 300 });
    if ($('#c-brand').value) p.set('brand_id', $('#c-brand').value);
    if ($('#c-q').value.trim()) p.set('q', $('#c-q').value.trim());
    if ($('#c-empty')?.checked) p.set('include_empty', 1);
    const rows = await api('/api/products?' + p);
    $('#c-list').innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th></th><th>Kode</th><th>Produk</th><th>Brand</th><th>Jenis</th><th>Ukuran</th><th>Variasi</th><th>Sumber</th></tr></thead><tbody>
      ${rows.map(p => `<tr class="click" data-p="${p.id}"><td><span class="thumb" ${bgThumb(p.thumb_file_id, 300)}></span></td><td class="mono"><b>${esc(p.code)}</b></td>
        <td><b>${esc(p.name)}</b>${p.description ? `<div class="small muted">${esc(p.description)}</div>` : ''}</td><td>${esc(p.brand_name)}</td>
        <td>${(p.package_types || '').split(',').filter(Boolean).map(t => pkgBadge(t, true)).join(' ')}</td>
        <td class="mono small">${esc(p.dimensions || '-')}</td><td>${p.variant_count}</td>
        <td><span class="badge">${p.source === 'drive' ? 'Drive' : 'Manual'}</span></td></tr>`).join('')}</tbody></table></div>
      ${rows.length >= 300 ? '<div class="muted small" style="padding:10px 14px">Menampilkan 300 hasil pertama — persempit pencarian.</div>' : ''}` : '<div class="empty">Tidak ada produk.</div>';
    $$('tr[data-p]').forEach(tr => tr.onclick = () => openProduct(tr.dataset.p, load));
  };
  $('#c-brand').onchange = load; $('#c-empty') && ($('#c-empty').onchange = load);
  $('#c-q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  if (isAdmin) {
    $('#addp').onclick = () => openAddProduct(load);
    const showSync = s => {
      $('#sync-status').innerHTML = s.running ? '<div class="callout" style="margin-bottom:16px"><span class="spin"></span> Sinkronisasi dari Google Drive sedang berjalan…</div>'
        : s.last_error ? `<div class="callout err" style="margin-bottom:16px">Sinkron gagal: ${esc(s.last_error)}</div>`
        : s.stats ? `<div class="callout ok" style="margin-bottom:16px">Sinkron terakhir ${fmtDate(s.last_sync, true)}: ${s.stats.brands} brand, ${s.stats.products} produk, ${s.stats.variants} file (${s.stats.newProducts} produk baru, ${s.stats.newVariants} file baru).</div>` : '';
    };
    showSync(sync);
    $('#sync').onclick = e => busy(e.target, async () => {
      await api('/api/sync', { method: 'POST', body: {} });
      let s;
      do { await new Promise(r => setTimeout(r, 1500)); s = await api('/api/sync'); showSync(s); } while (s.running);
      if (!s.last_error) { toast('Katalog diperbarui dari Google Drive'); await getBrands(true); viewCatalog(main); }
    });
  }
  await load();
}

async function openProduct(id, reload) {
  const isAdmin = state.user.role === 'admin';
  const p = await api('/api/products/' + id);
  const m = modal(`${esc(p.code ? p.code + '. ' : '')}${esc(p.name)}`, `
    <div class="muted">${esc(p.brand_name)}${p.drive_link ? ` · <a href="${esc(p.drive_link)}" target="_blank" rel="noopener">Folder Google Drive</a>` : ''}</div>
    ${isAdmin ? `<div class="grid3">
      <label class="f">Kode<input class="input mono" id="e-code" value="${esc(p.code)}"></label>
      <label class="f" style="grid-column:span 2">Nama produk<input class="input" id="e-name" value="${esc(p.name)}"></label></div>
      <div class="grid2"><label class="f">Volume / isi<input class="input" id="e-vol" value="${esc(p.volume)}"></label>
      <label class="f">Link folder Drive<input class="input" id="e-link" value="${esc(p.drive_link)}"></label></div>
      <label class="f">Detail / deskripsi<textarea class="input" id="e-desc">${esc(p.description)}</textarea></label>` : p.description ? `<p>${esc(p.description)}</p>` : ''}
    <h3>File sticker / variasi (${p.variants.length})</h3>
    <div class="variants">${p.variants.map(v => `<div class="vcard" style="cursor:default"><div class="img" ${bgThumb(v.drive_file_id, 600)}>${v.drive_file_id ? `<button class="zoom" data-zoom="${esc(v.drive_file_id)}" data-caption="${esc(v.name)}">Perbesar</button>` : ''}</div>
      <div class="info">${isAdmin ? `<label class="f">Nama variasi<input class="input" data-vn="${v.id}" value="${esc(v.name)}"></label>
        <div class="grid3"><label class="f">Jenis desain <span class="hint">${v.package_type_manual ? '(diatur manual)' : '(deteksi otomatis)'}</span><select class="input" data-vt="${v.id}">${Object.entries(PKG).map(([k, l]) => `<option value="${k}" ${v.package_type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="f">Ukuran (dimensi)<input class="input mono" data-vd="${v.id}" value="${esc(v.dimension)}"></label><label class="f">Volume<input class="input" data-vv="${v.id}" value="${esc(v.volume)}"></label></div>`
        : `<b>${esc(v.name)}</b><div class="row">${pkgBadge(v.package_type)}${v.dimension ? `<span class="dim">${ICON.ruler} ${esc(v.dimension)}</span>` : ''}${v.volume ? `<span class="badge">${esc(v.volume)}</span>` : ''}</div>`}
        <div class="fname">${esc(v.file_name)}</div><div class="row">${v.drive_link ? `<a class="small" href="${esc(v.drive_link)}" target="_blank" rel="noopener">${ICON.drive} File mentah</a>` : ''}
        ${isAdmin ? `<button class="btn sm danger" data-vdel="${v.id}">Sembunyikan</button>` : ''}</div></div></div>`).join('') || '<div class="muted">Belum ada file.</div>'}</div>
    ${isAdmin ? `<details><summary class="btn sm">+ Tambah file / variasi</summary><div class="stack" style="margin-top:10px">${variantFields('nv')}<button class="btn" id="nv-add">Tambah variasi</button></div></details>` : ''}`,
  { wide: true, foot: isAdmin ? '<button class="btn danger" id="p-del">Sembunyikan produk</button><button class="btn" data-close>Tutup</button><button class="btn primary" id="p-save">Simpan</button>' : '' });
  if (!isAdmin) return;
  bindVariantFields(m.el, 'nv');
  $('#p-save', m.el).onclick = e => busy(e.target, async () => {
    await api('/api/products/' + p.id, { method: 'PUT', body: { code: $('#e-code', m.el).value, name: $('#e-name', m.el).value, volume: $('#e-vol', m.el).value, drive_link: $('#e-link', m.el).value, description: $('#e-desc', m.el).value } });
    for (const v of p.variants) {
      await api('/api/variants/' + v.id, { method: 'PUT', body: { name: $(`[data-vn="${v.id}"]`, m.el).value, dimension: $(`[data-vd="${v.id}"]`, m.el).value, volume: $(`[data-vv="${v.id}"]`, m.el).value, package_type: $(`[data-vt="${v.id}"]`, m.el).value } });
    }
    toast('Produk disimpan'); m.close(); reload();
  });
  $('#p-del', m.el).onclick = e => { if (confirm('Sembunyikan produk ini dari katalog?')) busy(e.target, async () => { await api('/api/products/' + p.id, { method: 'DELETE' }); m.close(); reload(); }); };
  $$('[data-vdel]', m.el).forEach(b => b.onclick = () => { if (confirm('Sembunyikan file ini?')) busy(b, async () => { await api('/api/variants/' + b.dataset.vdel, { method: 'DELETE' }); m.close(); openProduct(id, reload); }); });
  $('#nv-add', m.el).onclick = e => busy(e.target, async () => {
    await api(`/api/products/${p.id}/variants`, { method: 'POST', body: readVariantFields(m.el, 'nv') });
    toast('Variasi ditambahkan'); m.close(); openProduct(id, reload); reload();
  });
}

function variantFields(px) {
  return `<div class="grid2">
    <label class="f">Link file sticker di Google Drive<input class="input" id="${px}-link" placeholder="https://drive.google.com/file/d/…/view"></label>
    <label class="f">Nama variasi / nama file<input class="input" id="${px}-name" placeholder="mis. Label 250mL - 8,5 x 7 cm"></label>
    <label class="f">Ukuran (dimensi) <span class="hint">otomatis dari nama jika ada</span><input class="input mono" id="${px}-dim" placeholder="mis. 8,5 x 7 cm"></label>
    <label class="f">Volume / variasi<input class="input" id="${px}-vol" placeholder="mis. 250 mL"></label>
    <label class="f">Jenis desain<select class="input" id="${px}-type"><option value="">Otomatis dari nama file</option>${Object.entries(PKG).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label></div>
    <div id="${px}-prev"></div>`;
}
function bindVariantFields(root, px) {
  const upd = () => {
    const link = $(`#${px}-link`, root).value;
    const m = link.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || link.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
    $(`#${px}-prev`, root).innerHTML = m ? `<div class="row"><span class="thumb lg" ${bgThumb(m[1], 300)}></span><span class="small muted">Pratinjau dari Google Drive (file harus dibagikan “Siapa saja yang memiliki link”).</span></div>` : link ? '<div class="callout warn small">Gunakan link <b>file</b> (…/file/d/…), bukan link folder.</div>' : '';
    const name = $(`#${px}-name`, root).value;
    const dm = name.match(/(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*[x×X]\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)?/);
    if (dm && !$(`#${px}-dim`, root).dataset.touched) $(`#${px}-dim`, root).value = `${dm[1].replace('.', ',')} x ${dm[2].replace('.', ',')} ${dm[3] || 'cm'}`;
  };
  $(`#${px}-link`, root).oninput = upd; $(`#${px}-name`, root).oninput = upd;
  $(`#${px}-dim`, root).oninput = e => (e.target.dataset.touched = 1);
}
const readVariantFields = (root, px) => ({ drive_link: $(`#${px}-link`, root).value, name: $(`#${px}-name`, root).value, dimension: $(`#${px}-dim`, root).value, volume: $(`#${px}-vol`, root).value, package_type: $(`#${px}-type`, root).value || undefined });

async function openAddProduct(reload) {
  const brands = await getBrands(true);
  const m = modal('Tambah produk / sticker baru', `
    <div class="grid3">
      <label class="f">Brand<select class="input" id="a-brand"><option value="">— pilih —</option>${brands.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}<option value="__new">+ Brand baru…</option></select></label>
      <label class="f hidden" id="a-nb-wrap">Nama brand baru<input class="input" id="a-nb"></label>
      <label class="f">Kode produk<input class="input mono" id="a-code" placeholder="mis. M240"></label>
    </div>
    <label class="f">Nama produk<input class="input" id="a-name" placeholder="mis. Baby Body Wash Calamine 250mL"></label>
    <div class="grid2"><label class="f">Volume / isi<input class="input" id="a-vol" placeholder="mis. 250 mL"></label>
      <label class="f">Link folder produk di Drive <span class="hint">(opsional)</span><input class="input" id="a-folder"></label></div>
    <label class="f">Detail produk<textarea class="input" id="a-desc" placeholder="Bahan sticker, finishing, catatan cetak, dll."></textarea></label>
    <h3>File sticker</h3>
    ${variantFields('av')}
    <div class="callout small">Setelah disimpan, produk langsung tampil di form request user. Variasi lain dapat ditambahkan dari detail produk.</div>`,
  { wide: true, foot: '<button class="btn" data-close>Batal</button><button class="btn primary" id="a-save">Simpan Produk</button>' });
  bindVariantFields(m.el, 'av');
  $('#a-brand', m.el).onchange = e => $('#a-nb-wrap', m.el).classList.toggle('hidden', e.target.value !== '__new');
  $('#a-save', m.el).onclick = e => busy(e.target, async () => {
    let brandId = $('#a-brand', m.el).value;
    if (brandId === '__new') brandId = (await api('/api/brands', { method: 'POST', body: { name: $('#a-nb', m.el).value } })).id;
    await api('/api/products', { method: 'POST', body: {
      brand_id: brandId, code: $('#a-code', m.el).value, name: $('#a-name', m.el).value, volume: $('#a-vol', m.el).value,
      drive_link: $('#a-folder', m.el).value, description: $('#a-desc', m.el).value, variants: [readVariantFields(m.el, 'av')],
    } });
    state.brands = null; toast('Produk baru ditambahkan'); m.close(); reload();
  });
}

// ---------------- purchase request ----------------
async function openPurchaseRequest(r, supplier, reload) {
  const d = await api(`/api/requests/${r.id}/purchase-requests/draft?supplier=${encodeURIComponent(supplier)}`);
  const v = d.vendor || {};
  const m = modal(`Purchase Request — ${esc(supplier.replace(/^Lainnya:\s*/, ''))}`, `
    <div class="callout small">Dokumen formal ber-kop <b>PT SAINSGO KARYA INDONESIA</b> untuk dikirim ke vendor. Data vendor tersimpan otomatis untuk PR berikutnya.
      Kop surat, alamat kirim, dan ketentuan bisa diatur di menu <a href="#/kop">Kop Surat & PR</a>.</div>
    <h3>Vendor</h3>
    <div class="grid2">
      <label class="f">Nama vendor<input class="input" id="pr-vname" value="${esc(v.name || '')}"></label>
      <label class="f">Up. (contact person)<input class="input" id="pr-vcontact" value="${esc(v.contact_person || '')}"></label>
      <label class="f">Telepon / WA<input class="input" id="pr-vphone" value="${esc(v.phone || '')}"></label>
      <label class="f">Email<input class="input" id="pr-vemail" value="${esc(v.email || '')}"></label>
    </div>
    <label class="f">Alamat vendor<textarea class="input" id="pr-vaddr" style="min-height:52px">${esc(v.address || '')}</textarea></label>
    <h3>Detail PR</h3>
    <div class="grid3">
      <label class="f">Tanggal PR<input class="input" type="date" id="pr-date" value="${esc(d.pr_date)}"></label>
      <label class="f">Tanggal dibutuhkan / kirim<input class="input" type="date" id="pr-deliv" value="${esc(d.delivery_date || '')}"></label>
      <label class="f">Termin pembayaran<input class="input" id="pr-pay" value="${esc(d.payment_terms || '')}" placeholder="mis. 50% DP, pelunasan saat barang diterima"></label>
    </div>
    <label class="f">Alamat pengiriman<textarea class="input" id="pr-daddr" style="min-height:52px">${esc(d.delivery_address || '')}</textarea></label>
    <h3>Item <span class="hint muted small">(harga opsional — kosongkan bila menunggu penawaran vendor)</span></h3>
    <div class="table-wrap"><table class="t"><thead><tr><th>Item</th><th style="width:110px">Qty</th><th style="width:90px">Satuan</th><th style="width:140px">Harga satuan (Rp)</th><th>Spesifikasi / bahan</th></tr></thead><tbody>
    ${d.items.map(it => `<tr data-item="${it.id}">
      <td><div class="row"><span class="thumb" ${bgThumb(it.drive_file_id, 300)} data-zoom="${esc(it.drive_file_id)}"></span><div><b class="small">${esc(it.product_code ? it.product_code + '. ' : '')}${esc(it.product_name)}</b>
        <div class="small">${pkgBadge(it.package_type, true)} <span class="mono">${esc(it.dimension || '-')}</span></div>
        <div class="small muted mono">${it.batch_number || it.exp_code ? `BN ${esc(it.batch_number || '-')} · EXP ${esc(it.exp_code || '-')}` : 'Batch/exp belum diisi'}</div></div></div></td>
      <td><input class="input" type="number" min="1" data-f="qty" value="${it.qty}"></td>
      <td><input class="input" data-f="unit" value="pcs"></td>
      <td><input class="input" inputmode="numeric" data-f="unit_price" placeholder="—"></td>
      <td><input class="input" data-f="spec" value="${esc(it.notes || '')}" placeholder="mis. vinyl glossy, die-cut"></td></tr>`).join('')}</tbody></table></div>
    ${d.items.some(i => !i.generated_uuid) ? '<div class="callout warn small">Sebagian item belum punya file siap cetak (batch/exp belum di-generate). PR tetap bisa dibuat; link file master Google Drive akan dicantumkan.</div>' : ''}
    <div class="grid3">
      <label class="f">PPN (%)<input class="input" type="number" min="0" max="100" step="0.01" id="pr-tax" value="0"></label>
      <label class="f" style="grid-column:span 2">Catatan untuk vendor<input class="input" id="pr-notes" placeholder="opsional"></label>
    </div>`,
  { wide: true, foot: '<button class="btn" data-close>Batal</button><button class="btn primary" id="pr-go">Buat Purchase Request (PDF)</button>' });
  $('#pr-go', m.el).onclick = e => busy(e.target, async () => {
    const items = $$('tr[data-item]', m.el).map(tr => ({
      id: +tr.dataset.item, qty: $('[data-f=qty]', tr).value, unit: $('[data-f=unit]', tr).value,
      unit_price: $('[data-f=unit_price]', tr).value.replace(/[^\d]/g, ''), spec: $('[data-f=spec]', tr).value,
    }));
    const pr = await api(`/api/requests/${r.id}/purchase-requests`, { method: 'POST', body: {
      supplier, vendor_name: $('#pr-vname', m.el).value, vendor_contact: $('#pr-vcontact', m.el).value, vendor_phone: $('#pr-vphone', m.el).value,
      vendor_email: $('#pr-vemail', m.el).value, vendor_address: $('#pr-vaddr', m.el).value, pr_date: $('#pr-date', m.el).value,
      delivery_date: $('#pr-deliv', m.el).value, payment_terms: $('#pr-pay', m.el).value, delivery_address: $('#pr-daddr', m.el).value,
      tax_percent: $('#pr-tax', m.el).value, notes: $('#pr-notes', m.el).value, items,
    } });
    m.close();
    toast(`Purchase Request ${pr.number} dibuat`);
    window.open(pr.pdf_url, '_blank');
    await reload();
  });
}

async function viewCompany(main) {
  const c = await api('/api/settings/company');
  main.innerHTML = `
  <div class="page-head"><div><h1>Kop Surat & Purchase Request</h1><p>Data perusahaan yang tercetak di kop Purchase Request ke vendor.</p></div></div>
  <div class="split">
    <form class="card card-pad stack" id="cf">
      <div class="grid2">
        <label class="f">Nama perusahaan<input class="input" name="company_name" value="${esc(c.company_name)}"></label>
        <label class="f">Tagline / bidang usaha <span class="hint">(opsional)</span><input class="input" name="company_tagline" value="${esc(c.company_tagline)}"></label>
      </div>
      <label class="f">Alamat kantor<textarea class="input" name="company_address" style="min-height:56px">${esc(c.company_address)}</textarea></label>
      <div class="grid3">
        <label class="f">Telepon<input class="input" name="company_phone" value="${esc(c.company_phone)}"></label>
        <label class="f">Email<input class="input" name="company_email" value="${esc(c.company_email)}"></label>
        <label class="f">Website<input class="input" name="company_website" value="${esc(c.company_website)}"></label>
        <label class="f">NPWP <span class="hint">(opsional)</span><input class="input" name="company_npwp" value="${esc(c.company_npwp)}"></label>
        <label class="f">Kota (untuk tanggal surat)<input class="input" name="pr_city" value="${esc(c.pr_city)}"></label>
        <label class="f">Termin pembayaran default<input class="input" name="pr_payment_terms" value="${esc(c.pr_payment_terms)}"></label>
      </div>
      <label class="f">Alamat pengiriman default <span class="hint">(kosong = pakai alamat kantor)</span><textarea class="input" name="pr_delivery_address" style="min-height:56px">${esc(c.pr_delivery_address)}</textarea></label>
      <label class="f">Ketentuan di PR <span class="hint">(satu baris = satu poin)</span><textarea class="input" name="pr_terms" style="min-height:120px">${esc(c.pr_terms)}</textarea></label>
      <div><button class="btn primary">Simpan</button></div>
    </form>
    <div class="card card-pad stack sticky">
      <h2>Logo</h2>
      <div id="logo-prev" style="min-height:90px;display:grid;place-items:center;border:1px dashed var(--line);border-radius:8px;padding:10px">
        ${c.company_logo ? `<img src="${c.company_logo}" alt="Logo" style="max-height:90px;max-width:100%">` : '<span class="muted small">Belum ada logo — kop tampil tanpa logo (teks di tengah).</span>'}</div>
      <div class="row"><label class="btn sm">Upload logo (PNG/JPG)<input type="file" accept="image/png,image/jpeg" id="logo" hidden></label>
        ${c.company_logo ? '<button class="btn sm danger" id="logo-del" type="button">Hapus logo</button>' : ''}</div>
      <p class="small muted" style="margin:0">Setelah disimpan, buka detail request yang sudah disetujui lalu klik <b>+ PR</b> untuk membuat Purchase Request.</p>
    </div>
  </div>`;
  $('#cf').onsubmit = async e => {
    e.preventDefault();
    await busy(e.submitter, async () => { await api('/api/settings/company', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Kop surat disimpan'); });
  };
  $('#logo').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 1.4e6) return toast('Logo maksimal ±1,4 MB', true);
    const dataUrl = await new Promise(res => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(f); });
    try { await api('/api/settings/company', { method: 'PUT', body: { company_logo: dataUrl } }); toast('Logo disimpan'); viewCompany(main); }
    catch (err) { toast(err.message, true); }
  };
  $('#logo-del') && ($('#logo-del').onclick = async () => { await api('/api/settings/company', { method: 'PUT', body: { company_logo: '' } }); viewCompany(main); });
}

// ---------------- reports ----------------
async function viewReports(main) {
  const d = new Date(); const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const iso = x => { x = new Date(x); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  main.innerHTML = `
  <div class="page-head"><div><h1>Laporan PDF</h1><p>Rekap semua request dalam periode tertentu. Untuk ringkasan per request (dengan tanda tangan & link file), buka detail request lalu klik “Ringkasan PDF”.</p></div></div>
  <div class="card card-pad stack" style="max-width:720px">
    <div class="grid3">
      <label class="f">Dari tanggal<input class="input" type="date" id="r-from" value="${iso(first)}"></label>
      <label class="f">Sampai tanggal<input class="input" type="date" id="r-to" value="${iso(d)}"></label>
      <label class="f">Status<select class="input" id="r-st"><option value="">Semua</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    </div>
    <div class="row"><button class="btn primary" id="r-go">${ICON.pdf} Buat Laporan PDF</button></div>
  </div>
  <div class="card" style="margin-top:18px"><div class="card-head"><h2>Request disetujui — siap diteruskan ke vendor</h2></div><div id="r-ready"></div></div>`;
  $('#r-go').onclick = () => {
    const p = new URLSearchParams({ from: $('#r-from').value, to: $('#r-to').value });
    if ($('#r-st').value) p.set('status', $('#r-st').value);
    window.open('/api/reports/pdf?' + p, '_blank');
  };
  $('#r-ready').innerHTML = requestTable(await api('/api/requests?status=approved'));
  bindRequestRows($('#r-ready'));
}

// ---------------- users ----------------
async function viewUsers(main) {
  const users = await api('/api/users');
  main.innerHTML = `
  <div class="page-head"><div><h1>Pengguna</h1><p>Role menentukan akses: <b>User</b> membuat request · <b>Desainer, Manager Desain, Purchasing</b> ACC & tanda tangan · <b>Admin</b> mengelola katalog, batch/exp, dan laporan.</p></div>
    <button class="btn primary" id="u-add">+ Tambah Pengguna</button></div>
  <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Nama</th><th>Username</th><th>Role</th><th>Divisi</th><th>TTD</th><th>Status</th><th></th></tr></thead><tbody>
  ${users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td class="mono">${esc(u.username)}</td><td>${esc(ROLE[u.role])}</td><td>${esc(u.division || '')}</td>
    <td>${u.has_signature ? '✅' : '—'}</td><td>${u.active ? '<span class="badge approved">Aktif</span>' : '<span class="badge cancelled">Nonaktif</span>'}</td>
    <td><button class="btn sm" data-u="${u.id}">Ubah</button></td></tr>`).join('')}</tbody></table></div></div>`;
  const form = (u = {}) => `<div class="grid2">
    <label class="f">Nama lengkap<input class="input" id="u-name" value="${esc(u.name || '')}"></label>
    <label class="f">Username<input class="input mono" id="u-username" value="${esc(u.username || '')}" ${u.id ? 'disabled' : ''}></label>
    <label class="f">Role<select class="input" id="u-role">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="f">Divisi<input class="input" id="u-div" value="${esc(u.division || '')}"></label>
    <label class="f">${u.id ? 'Reset password <span class="hint">(kosongkan jika tidak diubah)</span>' : 'Password'}<input class="input" id="u-pw" type="password" autocomplete="new-password"></label>
    ${u.id ? `<label class="f">Status<select class="input" id="u-active"><option value="1" ${u.active ? 'selected' : ''}>Aktif</option><option value="0" ${u.active ? '' : 'selected'}>Nonaktif</option></select></label>` : ''}</div>`;
  const read = el => ({ name: $('#u-name', el).value, username: $('#u-username', el).value, role: $('#u-role', el).value, division: $('#u-div', el).value, password: $('#u-pw', el).value || undefined, active: $('#u-active', el) ? $('#u-active', el).value === '1' : undefined });
  $('#u-add').onclick = () => {
    const m = modal('Tambah pengguna', form({ role: 'user' }), { foot: '<button class="btn" data-close>Batal</button><button class="btn primary" id="ok">Simpan</button>' });
    $('#ok', m.el).onclick = e => busy(e.target, async () => { await api('/api/users', { method: 'POST', body: read(m.el) }); m.close(); toast('Pengguna ditambahkan'); viewUsers(main); });
  };
  $$('[data-u]').forEach(b => b.onclick = () => {
    const u = users.find(x => x.id === +b.dataset.u);
    const m = modal('Ubah pengguna', form(u), { foot: '<button class="btn" data-close>Batal</button><button class="btn primary" id="ok">Simpan</button>' });
    $('#ok', m.el).onclick = e => busy(e.target, async () => { await api('/api/users/' + u.id, { method: 'PUT', body: read(m.el) }); m.close(); toast('Tersimpan'); viewUsers(main); });
  });
}

// ---------------- profile ----------------
async function viewProfile(main) {
  const u = state.user;
  const { signature } = await api('/api/me/signature');
  main.innerHTML = `
  <div class="page-head"><div><h1>Profil & Tanda Tangan</h1><p>${esc(u.name)} · ${esc(ROLE[u.role])}</p></div></div>
  <div class="grid2">
    <div class="card card-pad stack"><h2>Tanda tangan digital</h2>
      <p class="muted small" style="margin:0">Dipakai otomatis saat Anda ACC request dan dicetak pada ringkasan PDF.</p>
      <canvas class="sigpad" id="pad"></canvas>
      <div class="row"><button class="btn" id="clr">Hapus</button><button class="btn primary" id="save">Simpan Tanda Tangan</button></div></div>
    <form class="card card-pad stack" id="pw"><h2>Ganti password</h2>
      <label class="f">Password lama<input class="input" type="password" name="old_password" required autocomplete="current-password"></label>
      <label class="f">Password baru<input class="input" type="password" name="new_password" required minlength="6" autocomplete="new-password"></label>
      <button class="btn primary">Simpan Password</button></form>
  </div>`;
  const pad = signaturePad($('#pad'));
  pad.load(signature);
  $('#clr').onclick = () => pad.clear();
  $('#save').onclick = e => busy(e.target, async () => { await api('/api/me/signature', { method: 'PUT', body: { signature: pad.isEmpty() ? '' : pad.toDataURL() } }); toast('Tanda tangan disimpan'); });
  $('#pw').onsubmit = async e => {
    e.preventDefault();
    await busy(e.submitter, async () => { await api('/api/me/password', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Password diganti'); });
  };
}

boot();

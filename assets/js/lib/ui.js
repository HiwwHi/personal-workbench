export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function toEl(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, type = '', ms = 2200) {
  const w = $('#toastWrap');
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  d.textContent = msg;
  w.appendChild(d);
  requestAnimationFrame(() => d.classList.add('show'));
  setTimeout(() => {
    d.classList.remove('show');
    setTimeout(() => d.remove(), 220);
  }, ms);
}

export function confirmBox(title, msg, okText = '确定', danger = true) {
  return new Promise(resolve => {
    const mask = toEl(`<div class="modal-mask"><div class="modal" style="width:420px">
      <div class="modal-head"><div class="modal-title">${esc(title)}</div></div>
      <div class="modal-body" style="font-size:13.5px;color:var(--text-2)">${esc(msg)}</div>
      <div class="modal-foot">
        <button class="btn" data-a="no">取消</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(okText)}</button>
      </div></div></div>`);
    mask.addEventListener('click', e => {
      if (e.target === mask) finish(false);
      const a = e.target.closest('[data-a]');
      if (a) finish(a.dataset.a === 'yes');
    });
    function finish(v) { mask.remove(); resolve(v); }
    $('#modalWrap').appendChild(mask);
  });
}

export function modal({ title, body, okText = '确定', onOk, wide = false, cancelText = '取消', done }) {
  const mask = toEl(`<div class="modal-mask"><div class="modal ${wide ? 'wide' : ''}">
      <div class="modal-head">
        <div class="modal-title">${title}</div>
        <button class="icon-btn" data-a="x"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        <button class="btn" data-a="no">${cancelText}</button>
        <button class="btn primary" data-a="yes">${okText}</button>
      </div></div></div>`);
  const bodyEl = $('.modal-body', mask);
  let closed = false;
  const close = () => { if (!closed) { closed = true; mask.remove(); } };
  mask.addEventListener('click', e => {
    if (e.target === mask) close();
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'x' || a.dataset.a === 'no') close();
    if (a.dataset.a === 'yes') {
      if (onOk && onOk(bodyEl, close) === false) return;
      close();
      if (done) done();
    }
  });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  $('#modalWrap').appendChild(mask);
  const firstInput = mask.querySelector('input,textarea,select');
  if (firstInput) firstInput.focus();
  return { el: mask, body: bodyEl, close };
}

export function ring(pct, size = 74, label = '', sub = '') {
  const r = (size - 12) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct)));
  return `<div class="ring-box">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="8"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--green)" stroke-width="8"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="${size / 2}" y="${size / 2 + 1}" text-anchor="middle" dominant-baseline="central"
        style="font-size:16px;font-weight:500;fill:var(--text);stroke:none">${label}</text>
    </svg>
    <div class="ring-label">${sub}</div>
  </div>`;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dateAdd(n, base = today()) {
  const d = new Date(base + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function relDate(s) {
  if (!s) return '';
  const t = today();
  if (s === t) return '今天';
  if (s === dateAdd(1)) return '明天';
  if (s === dateAdd(-1)) return '昨天';
  if (s < t) return '已逾期 ' + s.slice(5);
  const d = Math.round((new Date(s + 'T00:00:00') - new Date(t + 'T00:00:00')) / 86400000);
  if (d <= 7) return d + ' 天后';
  return s.slice(5);
}

export { download, copyText } from './store.js';

export function exportNothing() { }

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

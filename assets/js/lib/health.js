import * as store from './store.js';
import { today as todayStr, toast, toEl, esc, $ } from './ui.js';

const IDLE_MS = 5 * 60 * 1000;
const TICK_MS = 20000;

const DEFAULT_RULES = [
  { id: 'water', name: '喝水', interval: 30, enabled: true, msg: '起身接一杯水，顺走几步活动下肩颈' },
  { id: 'move', name: '起身活动', interval: 45, enabled: true, msg: '站起来走动两分钟，久坐对腰不太友好' },
  { id: 'eye', name: '护眼远眺', interval: 25, enabled: true, msg: '看 20 秒窗外的远处，让眼睛放松一下' }
];

export function ensureDefaults() {
  store.update(d => {
    if (!d.health) d.health = { rules: [], logs: {}, settings: {} };
    if (!d.health.rules || !d.health.rules.length) d.health.rules = DEFAULT_RULES.map(r => Object.assign({}, r));
    if (!d.health.logs) d.health.logs = {};
    if (!d.health.settings) d.health.settings = { enabled: true };
  });
}

export function rules() { ensureDefaults(); return store.load().health.rules; }

export function logOf(date = todayStr()) {
  ensureDefaults();
  const logs = store.load().health.logs;
  if (!logs[date]) { store.update(d => { d.health.logs[date] = { water: 0, move: 0, eye: 0 }; }); }
  return store.load().health.logs[date];
}

export function bump(kind, n = 1) {
  const d = todayStr();
  store.update(st => {
    if (!st.health.logs[d]) st.health.logs[d] = { water: 0, move: 0, eye: 0 };
    st.health.logs[d][kind] = (st.health.logs[d][kind] || 0) + n;
  });
}

let lastActive = Date.now();
let activeTodaySec = 0;
let snoozeUntil = {};
const elapsed = {};
let timer = null;
let running = false;

function throttle(fn, wait) {
  let last = 0;
  return function (...a) {
    const now = Date.now();
    if (now - last >= wait) { last = now; fn.apply(this, a); }
  };
}

const onAct = throttle(() => { lastActive = Date.now(); }, 5000);

export function isActive() { return Date.now() - lastActive < IDLE_MS; }
export function activeMinutes() { return Math.round(activeTodaySec / 60); }
export function nextIn(rule) {
  const left = Number(rule.interval) - (elapsed[rule.id] || 0);
  return Math.max(0, Math.round(left));
}

function fire(rule) {
  const wrap = $('#nudgeWrap');
  const until = snoozeUntil[rule.id] || 0;
  if (Date.now() < until) return;
  if (wrap.querySelector('[data-rule="' + rule.id + '"]')) return;

  const el = toEl(`<div class="nudge" data-rule="${esc(rule.id)}">
      <div class="nudge-title"><i class="nudge-dot"></i>${esc(rule.name)}提醒</div>
      <div class="nudge-body">${esc(rule.msg)}</div>
      <div class="nudge-progress"><i style="width:100%"></i></div>
      <div class="nudge-foot">
        <button class="btn sm" data-a="snooze">稍后 10 分钟</button>
        <button class="btn sm green" data-a="done">已完成</button>
      </div>
    </div>`);
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  const bar = el.querySelector('.nudge-progress i');
  let t = 0, life = 15000;
  const iv = setInterval(() => {
    t += 250;
    bar.style.width = Math.max(0, 100 - (t / life) * 100) + '%';
    if (t >= life) { clearInterval(iv); dismiss(); }
  }, 250);

  function dismiss() { clearInterval(iv); el.classList.remove('show'); setTimeout(() => el.remove(), 400); }

  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'done') {
      bump(rule.id);
      window.dispatchEvent(new CustomEvent('wb:refresh'));
      toast('已记录一次「' + rule.name + '」', 'ok');
    } else {
      snoozeUntil[rule.id] = Date.now() + 10 * 60 * 1000;
    }
    elapsed[rule.id] = 0;
    dismiss();
  });
}

function tick() {
  const st = store.load().health.settings || {};
  if (!st.enabled) return;
  if (Date.now() - lastActive >= IDLE_MS) {
    for (const k of Object.keys(elapsed)) elapsed[k] = Math.max(0, elapsed[k] - TICK_MS / 1000 / 60 * 0.6);
    return;
  }
  activeTodaySec += TICK_MS / 1000;
  const secs = TICK_MS / 1000 / 60;
  for (const r of rules()) {
    if (!r.enabled) continue;
    elapsed[r.id] = (elapsed[r.id] || 0) + secs;
    if (elapsed[r.id] >= Number(r.interval)) { fire(r); elapsed[r.id] = 0; }
  }
}

export function previewNotice(rule) {
  const r = Object.assign({ once: true }, rule);
  const saved = snoozeUntil[rule.id];
  delete snoozeUntil[rule.id];
  fire(r);
  if (saved) snoozeUntil[rule.id] = saved;
}

export function start() {
  if (running) return;
  running = true;
  ['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart', 'scroll'].forEach(ev =>
    window.addEventListener(ev, onAct, { passive: true }));
  timer = setInterval(tick, TICK_MS);
}

export function resetTimer(id) { elapsed[id] = 0; }

export function cumulative() { return { ...elapsed }; }

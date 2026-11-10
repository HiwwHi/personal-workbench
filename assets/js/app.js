import * as store from './lib/store.js';
import * as H from './lib/health.js';
import * as fsa from './lib/fsa.js';
import * as mdmod from './lib/md.js';
import { $, esc, modal, toast, download, today } from './lib/ui.js';

import * as home from './views/home.js';
import * as vault from './views/vault.js';
import * as tasks from './views/tasks.js';
import * as study from './views/study.js';
import * as skills from './views/skills.js';
import * as notes from './views/notes.js';
import * as jots from './views/jots.js';
import * as health from './views/health.js';
import * as system from './views/system.js';
import * as ai from './lib/aibridge.js';

const views = { home, vault, tasks, study, skills, notes, jots, health, system };
const ORDER = ['home', 'vault', 'tasks', 'study', 'skills', 'notes', 'jots', 'health', 'system'];
const SENSITIVE = ['vault', 'health', 'jots'];

let currentKey = null;

async function route() {
  let key = (location.hash.replace(/^#\//, '') || 'home').split('?')[0];
  if (store.settings().privacy && SENSITIVE.includes(key)) { location.hash = '#/home'; return; }
  const view = views[key] || home;
  currentKey = key;

  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.key === key));
  $('#pageTitle').textContent = view.meta.title;
  $('#pageSub').textContent = view.meta.sub || '';

  const root = $('#view');
  try {
    await view.mount(root);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="card"><div class="card-title">这个页面出了点问题</div>
      <div class="hint mt6">${esc(err.message || String(err))}</div></div>`;
  }
}

function refresh() { route(); }

function backupModal() {
  modal({
    title: '备份与导出', okText: '导出全量 JSON',
    body: `
      <div class="hint mb12">所有模块的数据都在这一个文件里。笔记本体在你自己选的文件夹里，不打包进来（因为那才是唯一真源）。</div>
      <div class="grid grid-3 mb12">
        <div class="stat"><div class="stat-num">${store.load().vault.length}</div><div class="stat-label">账号密码</div></div>
        <div class="stat"><div class="stat-num">${store.load().projects.length}</div><div class="stat-label">项目</div></div>
        <div class="stat"><div class="stat-num">${store.load().skills.length}</div><div class="stat-label">Skill</div></div>
      </div>
      <label class="field"><span>恢复：把以前导出的 JSON 整段粘进来（会覆盖当前数据）</span>
        <textarea rows="4" id="impJson" placeholder='{"__app":"personal-workbench", ...}'></textarea></label>
      <div class="hint">提示：JSON 里账号密码是<b>明文</b>的，别随手丢到网盘或聊天里。</div>`,
    onOk(body) {
      const t = body.querySelector('#impJson').value.trim();
      if (t) {
        try {
          store.importAll(t);
          toast('数据已恢复', 'ok');
          setTimeout(refresh, 200);
          return true;
        } catch (e) {
          toast('JSON 解析失败：' + e.message, 'warn');
          return false;
        }
      }
      download(`工作台备份-${today()}.json`, store.exportAll(), 'application/json;charset=utf-8');
      toast('已导出备份文件', 'ok');
      return true;
    }
  });
}

async function buildIndex() {
  const items = [];
  const d = store.load();
  // 隐私模式下敏感页进不去，索引里也不能出现它们的标题
  const hide = !!store.settings().privacy;
  if (!hide) d.vault.forEach(v => items.push({ kind: '密码', title: v.title, path: (v.group || '未分组') + ' · ' + (v.account || ''), go: '#/vault' }));
  d.projects.forEach(p => (p.tasks || []).forEach(t => items.push({ kind: '任务', title: t.title, path: (p.name || '') + (t.due ? ' · ' + t.due : ''), go: '#/tasks' })));
  d.study.forEach(s => items.push({ kind: '学习', title: s.name, path: s.deadline || '', go: '#/study' }));
  d.skills.forEach(s => items.push({ kind: 'Skill', title: s.name, path: s.description || '', go: '#/skills' }));
  if (!hide) d.jots.forEach(j => items.push({ kind: '随手记', title: String(j.text || '').slice(0, 40), path: (j.tags || []).join(' '), go: '#/jots' }));
  const seenMem = new Set();
  for (const slot of ['work', 'know']) {
    const label = slot === 'work' ? '流程笔记' : '知识笔记';
    if (fsa.supported() && await fsa.restoreDir(slot, { silent: true })) {
      for (const f of await fsa.listFiles(slot)) {
        items.push({ kind: label, title: f.name.replace(/\.md$/i, ''), path: f.path, go: '#/notes', slot });
      }
    } else {
      (d.notesDocs || []).filter(n => (n.slot || 'work') === slot).forEach(n => {
        seenMem.add(n.name);
        items.push({ kind: label, title: n.name, path: '内置', go: '#/notes', slot });
      });
    }
  }
  return items;
}

function openPalette() {
  const box = $('#palette');
  box.hidden = false;
  const input = $('#paletteInput');
  const list = $('#paletteList');
  input.value = '';
  input.focus();
  let index = [];
  let cur = 0;

  buildIndex().then(items => { index = items; paint(''); });

  function paint(q) {
    const hay = q.toLowerCase();
    const res = index.filter(i => [i.kind, i.title, i.path].join(' ').toLowerCase().includes(hay)).slice(0, 40);
    if (!res.length) { list.innerHTML = '<div class="empty">没有匹配项</div>'; return; }
    cur = 0;
    list.innerHTML = res.map((i, n) => `<div class="palette-row ${n === 0 ? 'sel' : ''}" data-n="${n}" data-go="${i.go}" data-slot="${i.slot || ''}">
        <span class="kind">${esc(i.kind)}</span>
        <span class="ptitle">${esc(i.title)}</span>
        <span class="ppath">${esc(i.path)}</span>
      </div>`).join('');
    Array.from(list.children).forEach((el, n) => {
      el.addEventListener('click', () => {
        if (res[n].slot) store.setSetting('notesSlot', res[n].slot);
        location.hash = res[n].go; close();
      });
      el.addEventListener('mouseenter', () => { cur = n; mark(); });
    });
  }

  function mark() {
    Array.from(list.children).forEach((el, n) => el.classList.toggle('sel', n === cur));
    if (list.children[cur]) list.children[cur].scrollIntoView({ block: 'nearest' });
  }

  function close() { box.hidden = true; }

  input.oninput = () => paint(input.value);
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, list.children.length - 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list.children[cur]) { location.hash = list.children[cur].dataset.go; close(); } }
    else if (e.key === 'Escape') close();
  };
  $('#paletteMask').onclick = close;
  box._once = true;
}

function boot() {
  const st = store.settings();
  const tid = system.applyTheme(st.theme);
  system.applyAccent(st.accent, tid);
  document.body.classList.toggle('privacy-on', !!st.privacy);
  ai.registerRoots().catch(() => {});  // 异步告知本地服务信任根目录，用于后续一键用 Cursor / VSCode 打开
  if (location.hash === '') location.hash = '#/home';
  H.ensureDefaults();
  H.start();

  window.addEventListener('hashchange', route);
  window.addEventListener('wb:refresh', () => { if (currentKey === 'health' || currentKey === 'home') route(); });

  // 本地存储写满时只提醒一次，别刷屏
  let storageWarned = false;
  window.addEventListener('wb:storage-error', () => {
    if (storageWarned) return;
    storageWarned = true;
    toast('本地存储写满了，最近的改动可能没存上。先去「备份与导出」导一份，再清掉不用的旧数据。', 'warn', 6000);
  });
  $('#searchTrigger').addEventListener('click', openPalette);
  $('#backupBtn').addEventListener('click', backupModal);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.shiftKey) { e.preventDefault(); openPalette(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      const inEditor = document.querySelector('#mdCode');
      if (!inEditor) e.preventDefault();
    }
  });

  route();
}

boot();

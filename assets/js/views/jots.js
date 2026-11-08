import * as store from '../lib/store.js';
import { esc, uid, modal, toast, confirmBox, copyText } from '../lib/ui.js';

export const meta = { key: 'jots', title: '随手记', sub: '想到就记，回车即存' };

let q = '';
let showArchived = false;

function jots() { return store.load().jots; }

function parseTags(text) {
  return (text.match(/#([^\s#]{1,12})/g) || []).map(t => t.slice(1));
}

function add(text) {
  const t = text.trim();
  if (!t) return;
  store.update(d => {
    d.jots.unshift({ id: uid(), text: t, tags: parseTags(t), pinned: false, archived: false, createdAt: new Date().toISOString() });
  });
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' 天前';
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function mount(root) {
  const all = jots().filter(j => !!j.archived === showArchived);
  const list = q
    ? all.filter(j => String(j.text || '').toLowerCase().includes(q.toLowerCase()))
    : all;
  const sorted = list.slice().sort((a, b) =>
    ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  root.innerHTML = `
    <div class="card mb12">
      <div class="jot-input">
        <input type="text" id="jp" placeholder="随手记点什么…打 # 可以加标签，回车直接保存">
        <button class="btn primary" id="jsave">记下来</button>
      </div>
      <div class="hint mt6">例：<code>机柜重启后要先等 30 秒再开 radio #弱电</code> · Ctrl+Enter 保存</div>
    </div>

    <div class="row-between mb12 wrap">
      <div class="row grow" style="max-width:320px">
        <input type="text" id="jq" placeholder="搜索随手记" value="${esc(q)}">
      </div>
      <div class="row">
        <button class="btn sm" id="jtoggle">${showArchived ? '回到记录' : '查看归档（' + jots().filter(j => j.archived).length + '）'}</button>
      </div>
    </div>

    ${sorted.length ? `<div class="grid grid-cards">${sorted.map(j => `
      <div class="jot-card" data-id="${j.id}">
        <div class="jt">
          ${j.pinned ? '<span class="tag amber">置顶</span> ' : ''}
          ${esc(j.text).replace(/#([^\s#]{1,12})/g, '<span class="tag blue">#$1</span>')}
          <div class="jm">
            <span>${timeAgo(j.createdAt)}</span>
            <button class="btn-ghost sm" data-act="copy">复制</button>
            <button class="btn-ghost sm" data-act="pin">${j.pinned ? '取消置顶' : '置顶'}</button>
            <button class="btn-ghost sm" data-act="arc">${j.archived ? '恢复' : '归档'}</button>
            <button class="btn-ghost sm" data-act="del">删除</button>
          </div>
        </div>
      </div>`).join('')}</div>` : '<div class="card"><div class="empty">还没有记录，上面写一条试试</div></div>'}
  `;

  const input = root.querySelector('#jp');
  const save = () => { add(input.value); input.value = ''; mount(root); };
  root.querySelector('#jsave').addEventListener('click', save);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
  });
  input.focus();

  const jq = root.querySelector('#jq');
  jq.addEventListener('input', () => { q = jq.value; mount(root); const n = root.querySelector('#jq'); n.focus(); n.setSelectionRange(q.length, q.length); });
  root.querySelector('#jtoggle').addEventListener('click', () => { showArchived = !showArchived; mount(root); });

  root.querySelectorAll('.jot-card').forEach(card => {
    card.addEventListener('click', async e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const j = jots().find(x => x.id === card.dataset.id);
      switch (btn.dataset.act) {
        case 'copy': {
          const ok = await copyText(j.text);
          toast(ok ? '已复制' : '复制失败', ok ? 'ok' : 'warn');
          break;
        }
        case 'pin':
          store.update(d => { d.jots.find(x => x.id === j.id).pinned = !j.pinned; });
          mount(root); break;
        case 'arc':
          store.update(d => { d.jots.find(x => x.id === j.id).archived = !j.archived; });
          toast(j.archived ? '已恢复' : '已归档'); mount(root); break;
        case 'del':
          if (await confirmBox('删除随手记', '确定删除这条？', '删除')) {
            store.update(d => { d.jots = d.jots.filter(x => x.id !== j.id); });
            mount(root);
          }
          break;
      }
    });
  });
}

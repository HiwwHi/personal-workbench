import * as store from '../lib/store.js';
import { esc, uid, modal, toast, confirmBox, copyText, today } from '../lib/ui.js';

const INBOX = '收件箱';

export const meta = { key: 'jots', title: '随手记', sub: '想到就记，回车即存' };

let q = '';
let showArchived = false;
let tagFilter = '';

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
  tagFilter = '';        // 新记录可能不带当前筛选的标签，清掉以免"记了却看不见"
}

/* 把一条随手记变成任务：没项目时自动建一个「收件箱」，原记录归档留底 */
function toTask(j, root) {
  const title = String(j.text || '').replace(/#[^\s#]{1,12}/g, '').trim().slice(0, 60) || '未命名任务';
  store.update(d => {
    let p = d.projects.find(x => x.name === INBOX);
    if (!p) {
      p = { id: uid(), name: INBOX, owner: '', due: '', desc: '从随手记转过来的待办先放这里', modules: [], tasks: [], createdAt: today() };
      d.projects.unshift(p);
    }
    p.tasks = p.tasks || [];
    p.tasks.unshift({
      id: uid(), title, due: today(), moduleId: '', repeat: 'none', priority: 'normal',
      done: false, doneAt: null, lastDone: null, history: []
    });
    const src = d.jots.find(x => x.id === j.id);
    if (src) { src.archived = true; src.convertedAt = today(); }
  });
  toast('已加入「收件箱」，原记录已归档', 'ok');
  mount(root);
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
  const tags = Array.from(new Set(all.flatMap(j => j.tags || []))).sort();
  if (tagFilter && !tags.includes(tagFilter)) tagFilter = '';
  const kw = q.toLowerCase();
  const list = all.filter(j =>
    (!tagFilter || (j.tags || []).includes(tagFilter)) &&
    (!kw || String(j.text || '').toLowerCase().includes(kw)));
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
        ${showArchived && jots().filter(j => j.archived).length ? '<button class="btn sm" id="jclear">清空归档</button>' : ''}
      </div>
    </div>

    ${tags.length ? `<div class="row wrap mb12" style="gap:6px">
      <span class="hint">标签：</span>
      ${tags.map(t => `<span class="tag ${tagFilter === t ? 'blue' : ''}" data-tag="${esc(t)}" style="cursor:pointer">#${esc(t)}</span>`).join('')}
      ${tagFilter ? '<span class="hint" data-tag="" style="cursor:pointer">清除筛选</span>' : ''}
    </div>` : ''}

    ${sorted.length ? `<div class="grid grid-cards">${sorted.map(j => `
      <div class="jot-card" data-id="${j.id}">
        <div class="jt">
          ${j.pinned ? '<span class="tag amber">置顶</span> ' : ''}
          ${esc(j.text).replace(/#([^\s#]{1,12})/g, '<span class="tag blue">#$1</span>')}
          <div class="jm">
            <span>${timeAgo(j.createdAt)}</span>
            <button class="btn-ghost sm" data-act="copy">复制</button>
            <button class="btn-ghost sm" data-act="task" title="复制成一条任务，放到「收件箱」项目里">转任务</button>
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

  const jclear = root.querySelector('#jclear');
  if (jclear) jclear.addEventListener('click', async () => {
    const n = jots().filter(j => j.archived).length;
    if (!n) return;
    if (!(await confirmBox('清空归档', `删除 ${n} 条已归档的随手记？删除后无法恢复。`, '删除'))) return;
    store.update(d => { d.jots = d.jots.filter(j => !j.archived); });
    toast('已清空归档');
    mount(root);
  });
  root.querySelectorAll('[data-tag]').forEach(el => el.addEventListener('click', () => {
    tagFilter = el.dataset.tag || '';
    mount(root);
  }));

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
        case 'task':
          toTask(j, root); break;
        case 'pin':
          store.update(d => { d.jots.find(x => x.id === j.id).pinned = !j.pinned; });
          mount(root); break;
        case 'arc': {
          // 先记下目标状态：store 里的 j 是活引用，翻转后读到的就是新值，提示会反
          const next = !j.archived;
          store.update(d => {
            const x = d.jots.find(y => y.id === j.id);
            if (x) x.archived = next;
          });
          toast(next ? '已归档' : '已恢复');
          mount(root);
          break;
        }
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

import * as store from '../lib/store.js';
import { esc, uid, modal, toast, confirmBox, copyText, today } from '../lib/ui.js';

const INBOX = '收件箱';

export const meta = { key: 'jots', title: '随手记', sub: '想到就记，回车即存' };

let q = '';
let showArchived = false;
let tagFilter = '';

function jots() { return store.load().jots; }

/* 标签边界：遇到空白或中英文标点就断开。
   原来只按空白切，`#弱电，记得带工具` 会整个变成一条标签 */
const TAG_BODY = '[^\\s#，。、；：！？,.;:!?（）()\\[\\]【】「」『』]{1,12}';
const TAG_PARSE_RE = new RegExp('#' + TAG_BODY, 'g');
const TAG_SPLIT_RE = new RegExp('(#' + TAG_BODY + ')', 'g');
const TAG_ONLY_RE = new RegExp('^#' + TAG_BODY + '$');

function parseTags(text) {
  return (String(text || '').match(TAG_PARSE_RE) || []).map(t => t.slice(1));
}

/* 高亮 #标签：先在原文上切分，再逐段转义。
   反过来（先 esc 再替换）会把 &#39; 里的 #39; 当成标签，正文里的单引号就变样了 */
function highlightTags(text) {
  return String(text == null ? '' : text)
    .split(TAG_SPLIT_RE)
    .map(part => (TAG_ONLY_RE.test(part)
      ? `<span class="tag blue">${esc(part)}</span>`
      : esc(part)))
    .join('');
}

function add(text) {
  const t = text.trim();
  if (!t) return;
  store.update(d => {
    d.jots.unshift({ id: uid(), text: t, tags: parseTags(t), pinned: false, archived: false, createdAt: new Date().toISOString() });
  });
  tagFilter = '';        // 新记录可能不带当前筛选的标签，清掉以免"记了却看不见"
}

/* 把一条随手记变成任务：选项目（默认收件箱），原记录归档留底 */
function toTask(j, root) {
  const title = String(j.text || '').replace(TAG_PARSE_RE, '').trim().slice(0, 60) || '未命名任务';
  const prjs = (store.load().projects || []).slice();
  const inbox = prjs.find(p => p.name === INBOX);
  modal({
    title: '转成任务', okText: '创建',
    body: `<div class="hint mb8">任务标题：${esc(title)}</div>
      <label class="field"><span>放到哪个项目</span>
        <select data-f="prj">
          ${inbox ? `<option value="${esc(inbox.id)}" selected>${esc(INBOX)}</option>` : ''}
          ${prjs.filter(p => p.name !== INBOX).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
          <option value="">（新建「收件箱」）</option>
        </select>
      </label>
      <div class="hint mt6">转换后这条记录会归档，归档里还能找回。</div>`,
    onOk(body) {
      const pid = body.querySelector('[data-f="prj"]').value;
      let where = '';
      store.update(d => {
        let p = pid ? d.projects.find(x => x.id === pid) : null;
        if (!p) {
          p = d.projects.find(x => x.name === INBOX);
          if (!p) {
            p = { id: uid(), name: INBOX, owner: '', due: '', desc: '从随手记转过来的待办先放这里', modules: [], tasks: [], createdAt: today() };
            d.projects.unshift(p);
          }
        }
        p.tasks = p.tasks || [];
        p.tasks.unshift({
          id: uid(), title, due: today(), moduleId: '', repeat: 'none', priority: 'normal',
          done: false, doneAt: null, lastDone: null, history: []
        });
        const src = d.jots.find(x => x.id === j.id);
        if (src) { src.archived = true; src.convertedAt = today(); }
        where = p.name;
      });
      toast('已加到「' + where + '」，原记录已归档', 'ok');
      mount(root);
      return true;
    }
  });
}

/* 编辑已有记录：改完重新解析 #标签，原文不保留历史 */
function editJot(j, root) {
  modal({
    title: '编辑随手记', wide: true, okText: '保存',
    body: `<label class="field"><span>内容（#标签 会重新解析）</span>
        <textarea rows="6" data-f="text">${esc(j.text)}</textarea></label>`,
    onOk(body) {
      const t = body.querySelector('[data-f="text"]').value.trim();
      if (!t) { toast('内容不能为空', 'warn'); return false; }
      store.update(d => {
        const x = d.jots.find(y => y.id === j.id);
        if (x) { x.text = t; x.tags = parseTags(t); x.editedAt = new Date().toISOString(); }
      });
      toast('已保存', 'ok');
      mount(root);
      return true;
    }
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
          ${highlightTags(j.text)}
          <div class="jm">
            <span>${timeAgo(j.createdAt)}</span>
            <button class="btn-ghost sm" data-act="copy">复制</button>
            <button class="btn-ghost sm" data-act="task" title="复制成一条任务，放到「收件箱」项目里">转任务</button>
            <button class="btn-ghost sm" data-act="edit">编辑</button>
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
        case 'edit':
          editJot(j, root); break;
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

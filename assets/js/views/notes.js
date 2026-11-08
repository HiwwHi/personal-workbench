import * as store from '../lib/store.js';
import * as fsa from '../lib/fsa.js';
import * as mdmod from '../lib/md.js';
import * as ai from '../lib/aibridge.js';
import { esc, modal, toast, confirmBox, copyText, download, uid } from '../lib/ui.js';

export const meta = { key: 'notes', title: '学习笔记', sub: '只读优先 · 手动确认才写盘' };

let source = null;
let slot = 'work';
let files = [];
let current = null;
let text = '';
let modified = null;
let mode = 'read';
let dirty = false;
let query = '';
let focusSec = null;
let outlineOnly = false;

const srcKey = () => (source ? source.key : '');

const sanitize = s => String(s).replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 60);

const mem = {
  key: 'mem',
  label: '内置笔记库',
  async list() {
    return (store.load().notesDocs || []).filter(d => (d.slot || 'work') === slot)
      .map(d => ({ name: d.name, path: d.name, _mem: true }));
  },
  async read(f) {
    const d = (store.load().notesDocs || []).find(x => x.name === f.path);
    return { text: d ? d.content : '', modified: 0 };
  },
  async save(f, content) {
    store.update(d => {
      const x = (d.notesDocs || []).find(y => y.name === f.path);
      if (x) x.content = content;
    });
    return { ok: true, modified: 0 };
  },
  async create(name, content) {
    store.update(d => {
      d.notesDocs = d.notesDocs || [];
      d.notesDocs.unshift({ id: uid(), name, slot, content: content || '# ' + name + '\n\n' });
    });
  },
  async trash(f) {
    store.update(d => { d.notesDocs = (d.notesDocs || []).filter(x => x.name !== f.path); });
  }
};

const disk = {
  key: 'fsa',
  label: '本地文件夹',
  async list() { return fsa.listFiles(slot); },
  async read(f) { return fsa.readFile(f.handle); },
  async save(f, content, mod) { return saveWithBackupSafe(f, content, mod); },
  async create(name, content) { return fsa.createFile(slot, '', sanitize(name) + '.md', content || '# ' + name + '\n\n'); },
  async trash(f) { return fsa.moveToTrash(slot, f); }
};

/* 保存前若没设置中间文件目录，先引导选择一次 */
async function saveWithBackupSafe(f, content, mod) {
  try {
    return await fsa.saveWithBackup(slot, f, content, mod);
  } catch (err) {
    if (err && err.code === 'NO_RUNTIME') {
      const ok = await confirmBox(
        '还需要选一个「中间文件目录」',
        '写盘前要先把原文件备份。请选择一个目录专门放备份 / 回收站 / 导出文件（建议建在工作台项目的上一层，比如「工作台文件」）。\n\n它不会碰你的笔记源目录。',
        '去选择'
      );
      if (!ok) return { cancelled: true };
      try {
        await fsa.pickDir('runtime');
        return await fsa.saveWithBackup(slot, f, content, mod);
      } catch (e2) { return { cancelled: true }; }
    }
    throw err;
  }
}

async function initSource(force = false) {
  if (source && !force) return;
  const ui = store.notesSlotUI(slot);
  if (ui.source === 'mem') { source = mem; return; }
  if (fsa.supported()) {
    const h = await fsa.restoreDir(slot, { silent: true });
    if (h) { source = disk; return; }
  }
  source = null;
}

async function switchSlot(next) {
  if (next === slot) return;
  slot = next;
  store.setSetting('notesSlot', next);
  source = null; files = []; current = null; text = ''; modified = null;
  dirty = false; query = ''; focusSec = null; mode = 'read';
  await initSource(true);
  if (source) await loadFiles();
  render();
}

function bumpRecent(path, section) {
  store.update(() => {
    const s = store.notesSlotUI(slot);
    const k = path + '::' + (section || '');
    s.recent[k] = (s.recent[k] || 0) + 1;
    s.last = path;
  });
}

function recentList() {
  const r = store.notesSlotUI(slot).recent || {};
  return Object.entries(r).map(([k, v]) => {
    const i = k.indexOf('::');
    return { path: i < 0 ? k : k.slice(0, i), section: i < 0 ? '' : k.slice(i + 2), count: v };
  }).sort((a, b) => b.count - a.count).slice(0, 3);
}

async function loadFiles() {
  files = source ? await source.list() : [];
}

async function openFile(f, section) {
  const res = await source.read(f);
  if (dirty && !(await confirmBox('有未保存的修改', '当前笔记还没保存到磁盘，切换会丢失。确定离开吗？', '放弃修改'))) return;
  text = res.text;
  modified = res.modified;
  current = f;
  dirty = false;
  mode = 'read';
  focusSec = section || null;
  bumpRecent(f.path, section || '');
  render();
  if (section) scrollToHeading(section);
}

function scrollToHeading(title) {
  requestAnimationFrame(() => {
    if (mode !== 'read') return;
    const secs = document.querySelectorAll('section.doc-sec');
    for (const s of secs) {
      if (s.dataset.title === title) {
        s.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.querySelectorAll('section.doc-sec').forEach(x => x.classList.remove('focus'));
        s.classList.add('focus');
        break;
      }
    }
  });
}

function sections() { return mdmod.sliceDoc(text); }

async function doSave() {
  if (!current || !source) return;
  const r = await source.save(current, text, srcKey() === 'fsa' ? modified : 0);
  if (r.cancelled) return;
  if (r.conflict) {
    const ok = await confirmBox(
      '文件已被外部修改',
      '这篇笔记在磁盘上被其他程序改动过（可能是你用 VSCode 改的）。覆盖会把外部改动冲掉。',
      '仍然覆盖'
    );
    if (!ok) { toast('已取消保存，未改动任何文件', 'warn'); return; }
    const force = await source.save(current, text, null);
    if (force.ok) { modified = force.modified; dirty = false; toast('已保存', 'ok'); render(); }
    return;
  }
  modified = r.modified;
  dirty = false;
  toast(srcKey() === 'fsa' ? '已保存到磁盘（原文件已备份到中间文件目录）' : '已保存', 'ok');
  render();
}

function chapterBody(sec) {
  return mdmod.trimLines(sec.lines);
}

function exportChapter(sec) {
  const base = current ? current.name.replace(/\.md$/i, '') : '笔记';
  const name = `${base}-${sanitize(sec.title)}.md`;
  const body = chapterBody(sec);
  const hasRt = fsa.runtimeReady();
  modal({
    title: '导出章节 · ' + sec.title, wide: true,
    okText: hasRt ? '保存到中间文件目录' : '下载 md 文件',
    body: `<div class="hint mb8">文件名：<code>${esc(name)}</code> · ${body.split('\n').length} 行。原文不会被改动，笔记源目录里也不会多出碎片文件。</div>
      <div class="hint mb12">${hasRt
        ? '会存到「中间文件目录/导出/」，你可以直接拷给同事，之后删掉也不影响原笔记。'
        : '还没设置中间文件目录，将直接下载。去「系统设置」设置一个更省心。'}</div>
      <div class="grid grid-2">
        <div><div class="card-title mb8">源码预览</div><pre class="md-preview" style="max-height:46vh;overflow:auto">${esc(body)}</pre></div>
        <div><div class="card-title mb8">渲染预览</div><div class="mdview" style="max-height:46vh;overflow:auto;border:1px solid var(--border);border-radius:8px">${mdmod.render(body)}</div></div>
      </div>`,
    onOk: async () => {
      try {
        const rel = await fsa.writeRuntime('导出', name, body);
        toast('已保存到 中间文件目录/' + rel, 'ok');
      } catch (e) {
        download(name, body, 'text/markdown;charset=utf-8');
        toast('中间文件目录不可用，已改为下载', 'warn');
      }
      return true;
    }
  });
}

function exportToAI(scope) {
  if (!current) return;
  let payload = '';
  const name = current.name.replace(/\.md$/i, '');
  if (scope === 'outline') {
    payload = `这是《${name}》的完整章节大纲，请先看这份大纲：

${sections().filter(s => s.level >= 1).map(s => '- '.repeat(1) + '  '.repeat(s.level - 1) + '(' + '#'.repeat(s.level) + ') ' + s.title).join('\n')}

我要你做的是（下面这句请你按需修改后再发给我）：
`;
  } else {
    payload = `这是《${name}》的完整内容（Markdown 原文）：

\`\`\`markdown
${text}
\`\`\`

我要你做的是（下面这句请你按需修改后再发给我）：
`;
  }
  const tail = `\n【重要约束】
1. 请保持我现有的标题层级、排版风格、术语写法与我一致；
2. 只返回需要新增或修改的部分，**不要输出整篇文档**；
3. 返回时用 Markdown 代码块包裹，方便我一键回填；
4. **绝对不要直接修改我磁盘上的文件**，把结果给我确认即可。`;

  modal({
    title: '导出给 AI · ' + name, wide: true, okText: '复制到剪贴板',
    body: `<div class="hint mb8">复制后，直接粘贴到和 WorkBuddy 的对话框里，在末尾补一句你的具体要求就行。</div>
      <textarea rows="18" style="font-family:ui-monospace,Consolas,monospace;font-size:12.5px">${esc(payload + tail)}</textarea>`,
    onOk(body) {
      const t = body.querySelector('textarea').value;
      copyText(t).then(ok => toast(ok ? '已复制，去对话框粘贴吧' : '复制失败', ok ? 'ok' : 'warn'));
      return true;
    }
  });
}

async function openInCursor() {
  if (!current) { toast('请先选一篇笔记', 'warn'); return; }
  if (srcKey() !== 'fsa') {
    toast('内置笔记库无法用 Cursor 打开，请先把笔记连到本地文件夹', 'warn'); return;
  }
  try {
    const dir = await fsa.currentDir(slot);
    if (!dir) throw new Error('未连接笔记源目录');
    if (!dir.root) throw new Error('请先在「系统设置 → AI 联动」里填写该笔记目录的绝对路径');
    const abs = (dir.root + '\\' + current.path).replace(/\//g, '\\');
    await ai.registerRoots();
    const line = focusSec && typeof focusSec.line === 'number' ? focusSec.line + 1 : undefined;
    await ai.openInEditor({ app: 'cursor', target: abs, line });
    toast('已在 Cursor 中打开' + (line ? `（跳到第 ${line} 行）` : ''), 'ok');
  } catch (e) { toast(e.message, 'warn'); }
}

function aiMerge() {
  if (!current) return;
  modal({
    title: 'AI 回填 · 需你确认才写入', wide: true, okText: '我确认无误，写入磁盘',
    body: `<div class="hint mb12">把 AI 返回的内容粘进来，先看预览。<b style="color:var(--amber)">只有点右下角按钮才会写文件</b>，写入前会自动备份原文件。</div>
      <label class="field"><span>回填方式</span>
        <select data-f="how">
          <option value="replace">整篇替换（AI 返回了完整新版本时用）</option>
          <option value="append">追加到文末（AI 只补充了新章节时用）</option>
        </select>
      </label>
      <label class="field"><span>AI 返回的内容（可含 Markdown 代码块）</span>
        <textarea rows="16" data-f="ai" style="font-family:ui-monospace,Consolas,monospace;font-size:12.5px" placeholder="把 AI 的回答整段粘进来…"></textarea></label>
      <div class="grid grid-2">
        <div><div class="card-title mb8">当前磁盘版本（前 40 行）</div><pre class="md-preview" style="max-height:32vh;overflow:auto">${esc(text.split('\n').slice(0, 40).join('\n'))}</pre></div>
        <div><div class="card-title mb8">回填预览</div><div class="mdview" id="mergePrev" style="max-height:32vh;overflow:auto;border:1px solid var(--border);border-radius:8px"><div class="empty">粘贴后自动预览</div></div></div>
      </div>`,
    onOk(body) {
      const how = body.querySelector('[data-f="how"]').value;
      let raw = body.querySelector('[data-f="ai"]').value.trim();
      if (!raw) { toast('内容为空', 'warn'); return false; }
      const fence = raw.match(/```(?:markdown|md)?\n([\s\S]*?)\n```/);
      if (fence) raw = fence[1];
      const next = how === 'append' ? text.replace(/\s*$/, '\n\n') + raw + '\n' : raw + (raw.endsWith('\n') ? '' : '\n');
      const nlines = next.split('\n').length, olines = text.split('\n').length;
      confirmBox('确认写入', `原 ${olines} 行 → 新 ${nlines} 行。确定写入《${current.name}》吗？写入前会自动备份。`, '确认写入').then(async yes => {
        if (!yes) { toast('已取消，文件未被改动'); return; }
        text = next;
        dirty = true;
        await doSave();
      });
      return true;
    }
  });
  setTimeout(() => {
    const ta = document.querySelector('#modalWrap [data-f="ai"]');
    const prev = document.querySelector('#modalWrap #mergePrev');
    if (!ta || !prev) return;
    ta.addEventListener('input', () => {
      let raw = ta.value.trim();
      const fence = raw.match(/```(?:markdown|md)?\n([\s\S]*?)\n```/);
      if (fence) raw = fence[1];
      prev.innerHTML = raw ? mdmod.render(raw) : '<div class="empty">粘贴后自动预览</div>';
    });
  }, 30);
}

function newNote() {
  modal({
    title: '新建笔记', okText: '创建',
    body: `<label class="field"><span>文件名（自动补 .md）</span><input type="text" data-f="name" placeholder="例：S7-1200 通信排障笔记"></label>`,
    onOk(body) {
      const n = body.querySelector('[data-f="name"]').value.trim();
      if (!n) { toast('请填写文件名', 'warn'); return false; }
      return (async () => {
        await source.create(n, '# ' + n + '\n\n## 第一节\n\n');
        await loadFiles();
        const f = files.find(x => x.name === sanitize(n) + '.md' || x.name === n + '.md' || x.path === n);
        await openFile(f || files[0]);
        toast('已创建', 'ok');
      })(), true;
    }
  }).close;
}

function renderSections() {
  return sections().map((s, i) => {
    if (s.level === 0) return `<section class="doc-sec" data-title="${esc(s.title)}">${mdmod.render(s.lines.join('\n'))}</section>`;
    const tools = `<span class="sec-tools">
        <button class="btn sm" data-chap="${i}">导出此章</button>
        <button class="btn sm" data-rec="${i}">标为常用</button>
      </span>`;
    const inner = mdmod.render(s.lines.join('\n'));
    return `<section class="doc-sec" data-title="${esc(s.title)}">${tools}${inner}</section>`;
  }).join('');
}

function toolbarHTML() {
  const srcLabel = srcKey() === 'fsa' ? '本地文件夹' : srcKey() === 'mem' ? '内置笔记库' : '未连接';
  return `
    <div class="mode-switch ${mode === 'edit' ? 'edit' : ''}">
      <button data-mode="read" class="${mode === 'read' ? 'on' : ''}">阅读模式</button>
      <button data-mode="edit" class="${mode === 'edit' ? 'on' : ''}">编辑模式</button>
    </div>
    <span class="readonly-banner">${mode === 'edit'
      ? `<i class="dirty-dot"></i>编辑中${dirty ? ' · 有未保存改动' : ''}`
      : '只读 · 任何修改都不会自动写入磁盘'}</span>
    <span class="grow"></span>
    <button class="btn sm" id="btnOutline" title="显示/隐藏大纲">大纲</button>
    <button class="btn sm" id="btnExportAI">导出给 AI</button>
    <button class="btn sm" id="btnOutlineOnly">仅大纲</button>
    <button class="btn sm" id="btnOpenCursor" title="用本机 Cursor 打开当前笔记${focusSec ? '并跳到「' + focusSec.title + '」那一行' : ''}">在 Cursor 中打开</button>
    <button class="btn sm" id="btnMerge">AI 回填</button>
    <button class="btn sm ${dirty ? 'primary' : ''}" id="btnSave" ${dirty ? '' : 'disabled'}>保存到磁盘</button>
  `;
}

function render() {
  const root = document.querySelector('#view');
  const recent = recentList();
  const visibleFiles = query
    ? files.filter(f => f.path.toLowerCase().includes(query.toLowerCase()))
    : files;

  root.innerHTML = `
    <div class="notes-layout">
      <div class="notes-side">
        <div class="notes-side-head">
          <div class="tabbar" style="margin-bottom:10px">
            <div class="tab ${slot === 'work' ? 'on' : ''}" data-slot="work">工作流程</div>
            <div class="tab ${slot === 'know' ? 'on' : ''}" data-slot="know">知识</div>
          </div>
          <div class="row-between mb8">
            <span class="tag ${srcKey() === 'fsa' ? 'green' : 'blue'}">${srcKey() === 'fsa' ? '本地文件夹' : srcKey() === 'mem' ? '内置笔记库' : '未连接'}</span>
            <button class="btn sm" id="btnPick">${srcKey() === 'fsa' ? '更换' : '连接'}</button>
          </div>
          <input type="text" id="nq" placeholder="搜索文件名" value="${esc(query)}">
          <div class="row mt6">
            <button class="btn sm" id="btnNew">+ 新建笔记</button>
            <button class="btn sm" id="btnRefresh">刷新</button>
          </div>
          ${srcKey() !== 'fsa' ? `<div class="hint mt6">现在是<b>${srcKey() === 'mem' ? '内置' : '未连接'}</b>模式${fsa.supported() ? '' : '（当前浏览器不支持文件夹直连，请用 Chrome / Edge）'}</div>
            ${fsa.supported() ? '<button class="btn sm primary mt6" id="btnPickReal">连接本地文件夹</button>' : '<button class="btn sm mt6" id="btnUseMem">改用内置笔记库</button>'}` : ''}
        </div>
        <div class="notes-list">
          ${visibleFiles.length ? visibleFiles.map(f => `
            <div class="note-item ${current && current.path === f.path ? 'on' : ''}" data-path="${esc(f.path)}">
              <svg viewBox="0 0 24 24" class="mini"><path d="M6 3h9l3 3v15H6z"/></svg>
              <span class="nm">${esc(f.name)}</span>
            </div>`).join('') : '<div class="empty" style="padding:20px 6px">没有笔记</div>'}
        </div>
      </div>

      <div class="notes-main">
        ${current ? `
          <div class="notes-bar">${toolbarHTML()}</div>
          <div class="notes-body">
            <div class="notes-split">
              ${outlineOnly === false ? `<div class="outline-pane">
                <div class="hint mb8">章节大纲</div>
                ${sections().filter(s => s.level >= 1 && s.level <= 3).map(s => `
                  <div class="out-line l${s.level} ${focusSec === s.title ? 'on' : ''}" data-goto="${esc(s.title)}">${esc(s.title)}</div>`).join('')}
              </div>` : ''}
              <div class="editor-pane">
                ${mode === 'edit' ? `
                  <div class="md-toolbar">${mdToolbar()}</div>
                  <textarea class="md-code" id="mdCode" spellcheck="false">${esc(text)}</textarea>
                ` : `<div class="mdview">${renderSections()}</div>`}
              </div>
            </div>
          </div>
        ` : `
          <div style="padding:40px;max-width:640px;margin:0 auto">
            <div class="card">
              <div class="card-title mb8">开始使用笔记</div>
              <div class="hint mb12">${fsa.supported()
      ? '选择一个存放 Markdown 笔记的本地文件夹。磁盘上的 md 文件就是唯一真源，你随时可以用 VSCode 打开它们，两边看到的是同一份文件。'
      : '当前浏览器不支持文件夹直连（需要 Chrome 或 Edge）。可以先用内置笔记库，数据保存在浏览器里，随时能导出 md。'}</div>
              <div class="recent-chips mb12">
                ${recent.length ? `<span class="hint">最近常看：</span>${recent.map(r => `<span class="recent-chip" data-recent="${esc(r.path)}" data-rsec="${esc(r.section)}">${esc(r.section || r.path.split('/').pop())}</span>`).join('')}` : ''}
              </div>
              ${fsa.supported() ? '<button class="btn primary" id="btnPickReal2">连接本地文件夹</button>' : '<button class="btn primary" id="btnUseMem2">使用内置笔记库</button>'}
            </div>
            <div class="card">
              <div class="card-title mb8">工作台对你文件的四条承诺</div>
              <ul class="hint" style="margin-left:18px">
                <li>打开笔记默认是阅读模式，编辑需要你手动切换</li>
                <li>切页面、关浏览器都不会自动保存</li>
                <li>每次保存前自动把原文件备份到你指定的「中间文件目录」，笔记源目录保持干净</li>
                <li>检测到文件被外部改过（比如你用 VSCode 改了）会拦下来问你</li>
                <li>AI 回填必须先预览确认，才会写入</li>
              </ul>
            </div>
          </div>
        `}
      </div>
    </div>
  `;

  wire();
}

function mdToolbar() {
  const b = (label, act, title) => `<button class="btn sm" data-md="${act}" title="${title || ''}">${label}</button>`;
  return `
    ${b('B', 'bold', '加粗 Ctrl+B')}${b('I', 'italic', '斜体 Ctrl+I')}${b('H', 'h', '标题 Ctrl+H')}
    <span class="sep"></span>
    ${b('列表', 'ul')}${b('编号', 'ol')}${b('任务', 'task')}${b('引用', 'quote')}
    <span class="sep"></span>
    ${b('代码', 'code', 'Ctrl+E')}${b('代码块', 'fence')}${b('链接', 'link', 'Ctrl+K')}${b('表格', 'table')}
    <span class="sep"></span>
    <span class="hint">Ctrl+S 保存</span>
  `;
}

function applyMarkdown(kind) {
  const ta = document.querySelector('#mdCode');
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e);
  let insert = sel, caret = null;

  const wrap = (l, r = l) => { insert = l + sel + r; caret = s + l.length + sel.length + (sel ? 0 : 0); };

  switch (kind) {
    case 'bold': wrap('**'); break;
    case 'italic': wrap('*'); break;
    case 'h': insert = '## ' + (sel || '标题'); break;
    case 'ul': insert = (sel || '一项').split('\n').map(l => '- ' + l).join('\n'); break;
    case 'ol': insert = (sel || '一项').split('\n').map((l, i) => `${i + 1}. ` + l).join('\n'); break;
    case 'task': insert = (sel || '待办').split('\n').map(l => '- [ ] ' + l).join('\n'); break;
    case 'quote': insert = (sel || '引用').split('\n').map(l => '> ' + l).join('\n'); break;
    case 'code': wrap('`'); break;
    case 'fence': insert = '\n```\n' + (sel || 'code') + '\n```\n'; break;
    case 'link': insert = `[${sel || '文字'}](url)`; break;
    case 'table': insert = '\n| 项 | 说明 |\n| --- | --- |\n|  |  |\n'; break;
  }
  ta.value = ta.value.slice(0, s) + insert + ta.value.slice(e);
  ta.focus();
  const pos = caret !== null ? caret : s + insert.length;
  ta.setSelectionRange(pos, pos);
  sync();
}

function sync() {
  const ta = document.querySelector('#mdCode');
  if (!ta) return;
  text = ta.value;
  dirty = true;
  const b = document.querySelector('#btnSave');
  if (b) { b.disabled = false; b.classList.add('primary'); }
  const badge = document.querySelector('.readonly-banner');
  if (badge) badge.innerHTML = '<i class="dirty-dot"></i>编辑中 · 有未保存改动';
}

function wire() {
  const root = document.querySelector('#view');

  root.querySelectorAll('[data-slot]').forEach(el => el.addEventListener('click', () => switchSlot(el.dataset.slot)));

  const q = root.querySelector('#nq');
  if (q) q.addEventListener('input', () => { query = q.value; render(); const n = document.querySelector('#nq'); n.focus(); n.setSelectionRange(query.length, query.length); });

  const bind = id => { const el = root.querySelector(id); if (el) return el; return null; };

  const pickReal = async () => {
    try {
      await fsa.pickDir(slot);
      source = disk;
      store.update(() => { store.notesSlotUI(slot).source = 'fsa'; });
      await loadFiles(); render(); toast('已连接笔记文件夹', 'ok');
    }
    catch (err) { toast('未选择文件夹', 'warn'); }
  };
  [root.querySelector('#btnPick'), root.querySelector('#btnPickReal'), root.querySelector('#btnPickReal2')].forEach(b => b && b.addEventListener('click', pickReal));
  [root.querySelector('#btnUseMem'), root.querySelector('#btnUseMem2')].forEach(b => b && b.addEventListener('click', async () => {
    source = mem;
    store.update(d => { d.notesDocs = d.notesDocs || []; store.notesSlotUI(slot).source = 'mem'; });
    await loadFiles(); render();
    toast('已切换到内置笔记库', 'ok');
  }));

  const bn = root.querySelector('#btnNew');
  if (bn) bn.addEventListener('click', () => {
    if (!source) { toast('请先连接笔记文件夹', 'warn'); return; }
    newNote();
  });
  const br = root.querySelector('#btnRefresh');
  if (br) br.addEventListener('click', async () => { await loadFiles(); render(); toast('已刷新'); });

  root.querySelectorAll('.note-item').forEach(el => el.addEventListener('click', () => {
    const f = files.find(x => x.path === el.dataset.path);
    openFile(f);
  }));

  root.querySelectorAll('[data-recent]').forEach(el => el.addEventListener('click', async () => {
    const f = files.find(x => x.path === el.dataset.recent);
    if (f) await openFile(f, el.dataset.rsec);
  }));

  root.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', async () => {
    const next = el.dataset.mode;
    if (next === mode) return;
    if (next === 'read' && dirty) {
      if (!(await confirmBox('有未保存的修改', '退出编辑模式会丢失未保存内容，确定吗？', '放弃修改'))) return;
      dirty = false;
    }
    mode = next; render();
  }));

  const saveBtn = root.querySelector('#btnSave');
  if (saveBtn) saveBtn.addEventListener('click', doSave);
  const bo = root.querySelector('#btnOutline');
  if (bo) bo.addEventListener('click', () => { outlineOnly = !outlineOnly; render(); });
  const bea = root.querySelector('#btnExportAI');
  if (bea) bea.addEventListener('click', () => exportToAI('full'));
  const boo = root.querySelector('#btnOutlineOnly');
  if (boo) boo.addEventListener('click', () => exportToAI('outline'));
  const bm = root.querySelector('#btnMerge');
  if (bm) bm.addEventListener('click', aiMerge);

  const boc = root.querySelector('#btnOpenCursor');
  if (boc) boc.addEventListener('click', openInCursor);

  root.querySelectorAll('[data-md]').forEach(b => b.addEventListener('click', () => applyMarkdown(b.dataset.md)));

  const ta = root.querySelector('#mdCode');
  if (ta) {
    ta.addEventListener('input', sync);
    ta.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        if (e.key === 'Tab') {
          e.preventDefault();
          const s = ta.selectionStart, en = ta.selectionEnd;
          const atStart = s === en && (s === 0 || ta.value[s - 1] === '\n');
          if (atStart) { ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s + 2; }
          else {
            const lineStart = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
            const block = ta.value.slice(lineStart, ta.selectionEnd);
            const add = e.shiftKey ? -2 : 2;
            const nl = block.split('\n').map(l => add > 0 ? '  ' + l : l.replace(/^ {1,2}/, '')).join('\n');
            ta.value = ta.value.slice(0, lineStart) + nl + ta.value.slice(ta.selectionEnd);
            ta.selectionStart = lineStart; ta.selectionEnd = lineStart + nl.length;
          }
          sync();
        }
        return;
      }
      const k = e.key.toLowerCase();
      const map = { b: 'bold', i: 'italic', h: 'h', e: 'code', k: 'link' };
      if (map[k]) { e.preventDefault(); applyMarkdown(map[k]); }
      if (k === 's') { e.preventDefault(); doSave(); }
    });
  }

  root.querySelectorAll('[data-chap]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const i = Number(b.dataset.chap);
    const sec = sections()[i];
    exportChapter(sec);
    bumpRecent(current.path, sec.title);
  }));
  root.querySelectorAll('[data-rec]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const sec = sections()[Number(b.dataset.rec)];
    bumpRecent(current.path, sec.title);
    toast('已记入常用章节', 'ok');
  }));
  root.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click', () => {
    const t = el.dataset.goto;
    focusSec = t;
    if (mode === 'read') scrollToHeading(t);
    else {
      const lines = text.split('\n');
      const idx = lines.findIndex(l => new RegExp('^#{1,6}\\s+' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$').test(l));
      const ta = document.querySelector('#mdCode');
      if (idx >= 0 && ta) {
        const pos = lines.slice(0, idx).join('\n').length + (idx ? 1 : 0);
        ta.focus(); ta.setSelectionRange(pos, pos);
        ta.scrollTop = Math.max(0, (idx - 4) * 24);
      }
    }
    bumpRecent(current.path, t);
  }));
}

export async function mount() {
  slot = store.settings().notesSlot || 'work';
  await initSource(true);
  if (!source) { render(); return; }
  await loadFiles();
  const pending = store.load().notesUI.pendingOpen;
  if (pending) {
    store.update(d => { d.notesUI.pendingOpen = null; });
    if (pending.slot && pending.slot !== slot) {
      slot = pending.slot;
      store.setSetting('notesSlot', slot);
      source = null;
      await initSource(true);
      if (source) await loadFiles();
    }
    const pf = files.find(x => x.path === pending.note);
    if (pf) { await openFile(pf, pending.section); return; }
  }
  const last = store.notesSlotUI(slot).last;
  const f = files.find(x => x.path === last);
  if (f) await openFile(f);
  else render();
}

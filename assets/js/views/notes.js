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
let saveKeyBound = false;

const srcKey = () => (source ? source.key : '');

/* 文件名只用安全字符：非法符号、路径分隔、连续点号都替换掉 */
const sanitize = s => String(s)
  .replace(/[\\/:*?"<>|\n\r\t]/g, '_')
  .replace(/\.{2,}/g, '.')
  .replace(/^[. ]+|[. ]+$/g, '')
  .slice(0, 60) || 'note';

/* 内置库以「槽位 + 名字」定位：两个槽位可以各有一篇同名笔记，不能互相覆盖 */
const memHit = (x, f) => (x.slot || 'work') === slot && x.name === f.path;

const mem = {
  key: 'mem',
  label: '内置笔记库',
  async list() {
    return (store.load().notesDocs || []).filter(d => (d.slot || 'work') === slot)
      .map(d => ({ name: d.name, path: d.name, _mem: true }));
  },
  async read(f) {
    const d = (store.load().notesDocs || []).find(x => memHit(x, f));
    return { text: d ? d.content : '', modified: 0 };
  },
  async save(f, content) {
    store.update(d => {
      const x = (d.notesDocs || []).find(y => memHit(y, f));
      if (x) x.content = content;
    });
    return { ok: true, modified: 0 };
  },
  async create(name, content) {
    let finalName = name;
    store.update(d => {
      d.notesDocs = d.notesDocs || [];
      // 同一槽位重名就自动加序号，避免两条同名笔记互相打架
      let i = 2;
      while (d.notesDocs.some(x => (x.slot || 'work') === slot && x.name === finalName)) {
        finalName = name + ' (' + (i++) + ')';
      }
      d.notesDocs.unshift({ id: uid(), name: finalName, slot, content: content || '# ' + finalName + '\n\n' });
    });
    return finalName;
  },
  async trash(f) {
    store.update(d => { d.notesDocs = (d.notesDocs || []).filter(x => !memHit(x, f)); });
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

/* 删到回收站：磁盘笔记要先有「中间文件目录」放副本，没设置就引导选一次 */
async function trashSafe(f) {
  try {
    return await source.trash(f);
  } catch (err) {
    if (err && err.code === 'NO_RUNTIME') {
      const ok = await confirmBox(
        '还需要选一个「中间文件目录」',
        '删除前要先把这篇内容放进回收站。请选择一个目录专门存放回收站 / 备份，它不会碰你的笔记源目录。',
        '去选择'
      );
      if (!ok) return null;
      try {
        await fsa.pickDir('runtime');
        return await source.trash(f);
      } catch { return null; }
    }
    throw err;
  }
}

async function initSource(force = false) {  if (source && !force) return;
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
  if (dirty) {
    const ok = await confirmBox('有未保存的修改', '切换笔记库会丢掉当前未保存的内容，确定吗？', '放弃修改');
    if (!ok) return;
    draftClear(current && current.path);
  }
  slot = next;
  store.setSetting('notesSlot', next);
  source = null; files = []; current = null; text = ''; modified = null;
  dirty = false; query = ''; focusSec = null; mode = 'read';
  await initSource(true);
  if (source) await loadFiles();
  render();
}

/* 草稿只写 localStorage，绝不碰磁盘：遵守「手动确认才写盘」，同时防编辑内容丢失 */
let draftTimer = null;
const DRAFT_MAX = 200000;          // 单篇超过 ~200KB 就不缓存，避免写爆本地存储
const DRAFT_KEEP = 5;              // 每个槽位最多留 5 篇草稿

function draftsOf() {
  const ui = store.notesSlotUI(slot);
  ui.drafts = ui.drafts || {};
  return ui.drafts;
}

function draftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!current || !dirty || !text || text.length > DRAFT_MAX) return;
    store.update(() => {
      const ds = draftsOf();
      ds[current.path] = { text, at: Date.now() };
      // 只留最近的几篇，别把 localStorage 塞满
      const keys = Object.keys(ds).sort((a, b) => Number(ds[b].at || 0) - Number(ds[a].at || 0));
      keys.slice(DRAFT_KEEP).forEach(k => { delete ds[k]; });
    });
  }, 1200);
}

function draftClear(path) {
  clearTimeout(draftTimer);
  store.update(() => {
    const ds = draftsOf();
    if (path) delete ds[path];
    else Object.keys(ds).forEach(k => { delete ds[k]; });
  });
}

/* 正文缓存：只为搜索服务，最多 200 篇、每篇前 2 万字符 */
function cacheBody(path, body) {
  const ui = store.notesSlotUI(slot);
  ui.textCache = ui.textCache || {};
  ui.textCache[path] = { t: String(body || '').slice(0, 20000), at: Date.now() };
  const keys = Object.keys(ui.textCache).sort((a, b) => (ui.textCache[b].at || 0) - (ui.textCache[a].at || 0));
  keys.slice(200).forEach(k => { delete ui.textCache[k]; });
  store.save();
}

/* 反链：用正文缓存 + 内置库内容扫 [[本篇名]]，不额外读盘（没打开过的磁盘笔记扫不到） */
function backlinksOf() {
  if (!current) return [];
  const name = current.name.replace(/\.md$/i, '');
  const needle = '[[' + name + ']]';
  const cache = store.notesSlotUI(slot).textCache || {};
  const mem = (store.load().notesDocs || []).filter(d => (d.slot || 'work') === slot);
  const out = [];
  for (const f of files) {
    if (f.path === current.path) continue;
    let body = (cache[f.path] && cache[f.path].t) || '';
    if (!body) {
      const m = mem.find(x => x.name === f.path);
      if (m) body = String(m.content || '');
    }
    if (body && body.indexOf(needle) >= 0) out.push(f);
  }
  return out;
}

function backlinksHTML() {
  const bl = backlinksOf();
  if (!bl.length) return '';
  return `<div class="card" style="margin-top:12px">
    <div class="card-head"><div class="card-title">被这些笔记引用（${bl.length}）</div><span class="hint">来自本地正文缓存</span></div>
    ${bl.map(f => `<div class="list-item" data-back="${esc(f.path)}">
        <div class="grow">${esc(f.name)}</div>
        <span class="hint">打开</span>
      </div>`).join('')}
  </div>`;
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

/* 读磁盘修改时间：并发 6，结果缓存起来，避免每次渲染都读一遍 */
async function fillMtimes() {
  if (srcKey() !== 'fsa') return;
  const mySlot = slot;
  const myFiles = files;
  const todo = myFiles.filter(f => f.handle && !f.mtime);
  if (!todo.length) return;
  const ui = store.notesSlotUI(mySlot);
  ui.mtimes = ui.mtimes || {};
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const f = todo[i++];
      try {
        const meta = await f.handle.getFile();
        f.mtime = meta.lastModified || 0;
        ui.mtimes[f.path] = f.mtime;
      } catch { f.mtime = 0; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  store.save();
  // 中途切了槽位或换了页面就别动：render() 会覆盖当前视图
  if (slot !== mySlot) return;
  const view = document.querySelector('#view');
  if (todo.some(f => f.mtime) && view && view.querySelector('.notes-layout')) render();
}

async function loadFiles() {
  files = source ? await source.list() : [];
  const mtimes = store.notesSlotUI(slot).mtimes || {};
  files.forEach(f => { if (mtimes[f.path]) f.mtime = mtimes[f.path]; });
  fillMtimes().catch(() => { });     // 后台补全，不阻塞首次渲染，失败也不打扰
}

async function openFile(f, section) {
  if (!f) return false;
  // 先问要不要放弃未保存的改动，再去读盘：原来顺序反了，用户点了「留下」也已经白读一遍
  if (dirty && !(await confirmBox('有未保存的修改', '当前笔记还没保存到磁盘，切换会丢失。确定离开吗？', '放弃修改'))) return false;

  let res;
  try {
    res = await source.read(f);
  } catch (err) {
    // 文件夹权限失效、文件被别的程序删掉都会走到这里：说清楚，别让整个页面崩成「出了点问题」
    toast('打开失败：' + ((err && err.message) || '文件读不出来') + '。可能是文件夹权限失效，去「系统设置」重新连接一次', 'warn', 5000);
    return false;
  }
  if (dirty) draftClear(current && current.path);      // 用户明确放弃，别留着下次又弹

  // 有本地草稿就问一句：恢复（不写盘）还是丢掉
  let draftText = '';
  const dft = draftsOf()[f.path];
  if (dft && String(dft.text) !== String(res.text)) {
    const mins = Math.max(1, Math.round((Date.now() - Number(dft.at || 0)) / 60000));
    const ok = await confirmBox('发现未保存的草稿',
      `《${f.name}》有一份 ${mins} 分钟前的内容只存在本机浏览器里，还没写进文件。要恢复到编辑框吗？`,
      '恢复草稿');
    if (ok) draftText = dft.text; else draftClear(f.path);
  }

  text = draftText || res.text;
  dirty = !!draftText;          // 恢复草稿后必须保持"未保存"，否则保存按钮一直灰着
  modified = res.modified;
  current = f;
  mode = 'read';
  focusSec = section || null;
  bumpRecent(f.path, section || '');
  cacheBody(f.path, text);          // 顺手把正文存进搜索缓存（不读盘也能搜正文）
  render();
  if (section) scrollToHeading(section);
  return true;
}

function scrollToHeading(title) {
  requestAnimationFrame(() => {
    if (mode !== 'read') return;
    // 系统开了「减少动效」就直接跳过去，别滑
    const smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const secs = document.querySelectorAll('section.doc-sec');
    for (const s of secs) {
      if (s.dataset.title === title) {
        s.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
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
    if (force.ok) { modified = force.modified; dirty = false; draftClear(current.path); toast('已保存', 'ok'); render(); }
    return;
  }
  modified = r.modified;
  dirty = false;
  draftClear(current.path);
  toast(srcKey() === 'fsa' ? '已保存到磁盘（原文件已备份到中间文件目录）' : '已保存', 'ok');
  render();
}

function chapterBody(sec) {
  return mdmod.trimLines(sec.lines);
}

async function exportChapter(sec) {
  const base = current ? current.name.replace(/\.md$/i, '') : '笔记';
  const name = `${base}-${sanitize(sec.title)}.md`;
  const body = chapterBody(sec);
  // runtimeReady 是异步的：不 await 会拿到 Promise（永远为真），没设目录时按钮文案会骗人
  const hasRt = await fsa.runtimeReady();
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

/* 导出整篇：和磁盘上的 md 一致，落到「中间文件目录/导出/」，没目录就下载 */
async function exportWhole() {
  if (!current) return;
  const name = current.name.replace(/\.md$/i, '') + '.md';
  const body = text;
  const hasRt = await fsa.runtimeReady();
  modal({
    title: '导出整篇 · ' + current.name, wide: true,
    okText: hasRt ? '保存到中间文件目录' : '下载 md 文件',
    body: `<div class="hint mb8">文件名：<code>${esc(name)}</code> · ${body.split('\n').length} 行${dirty ? ' · <b style="color:var(--amber)">注意：导出的是编辑器里改过、还没保存的版本</b>' : ''}</div>
      <div class="hint mb12">${hasRt ? '会存到「中间文件目录/导出/」，原笔记不受影响。' : '还没设置中间文件目录，将直接下载。'}</div>
      <pre class="md-preview" style="max-height:46vh;overflow:auto">${esc(body)}</pre>`,
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

function exportToAI(scope) {  if (!current) return;
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
    const root = await fsa.ensureAbsPath(slot);
    const abs = (root + '\\' + current.path).replace(/\//g, '\\');
    await ai.registerRoots();
    // focusSec 是章节标题，按标题找回行号，Cursor 才能跳到那一段
    const sec = focusSec ? sections().find(s => s.title === focusSec) : null;
    const line = sec ? sec.start + 1 : undefined;
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

const NOTE_TPL = {
  blank: n => '# ' + n + '\n\n',
  meeting: n => '# ' + n + '\n\n## 参会人\n\n## 议题\n\n## 结论\n\n## 待办\n\n- [ ] \n',
  retro: n => '# ' + n + '\n\n## 背景\n\n## 做对了什么\n\n## 哪里卡住\n\n## 下次怎么改\n',
  study: n => '# ' + n + '\n\n## 是什么\n\n## 为什么\n\n## 怎么用\n\n## 容易踩的坑\n'
};

function newNote() {
  modal({
    title: '新建笔记', okText: '创建',
    body: `<label class="field"><span>文件名（自动补 .md）</span><input type="text" data-f="name" placeholder="例：S7-1200 通信排障笔记"></label>
      <label class="field"><span>内容模板</span>
        <select data-f="tpl">
          <option value="blank">空白</option>
          <option value="meeting">会议记录</option>
          <option value="retro">复盘</option>
          <option value="study">学习笔记</option>
        </select>
      </label>`,
    onOk(body) {
      const n = body.querySelector('[data-f="name"]').value.trim();
      if (!n) { toast('请填写文件名', 'warn'); return false; }
      const tpl = body.querySelector('[data-f="tpl"]').value;
      const content = (NOTE_TPL[tpl] || NOTE_TPL.blank)(n);
      // 同名文件已存在就留在弹窗里让用户改名，别把磁盘上的原笔记截断
      const want = (sanitize(n) + '.md').toLowerCase();
      if (files.some(f => String(f.name).toLowerCase() === want)) {
        toast('这个名字已经存在，换一个吧', 'warn');
        return false;
      }
      (async () => {
        try {
          await source.create(n, content);
          await loadFiles();
          const f = files.find(x => x.name === sanitize(n) + '.md' || x.name === n + '.md' || x.path === n);
          await openFile(f || files[0]);
          toast('已创建', 'ok');
        } catch (e) { toast(e.message || '创建失败', 'warn'); }
      })();
      return true;
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

/* 字数与阅读时间：按非空白字符算，中文大约 300 字 / 分钟 */
function statLine(src) {
  const chars = String(src || '').replace(/\s+/g, '').length;
  return `${chars.toLocaleString('zh-CN')} 字 · 约 ${Math.max(1, Math.round(chars / 300))} 分钟`;
}

function toolbarHTML() {
  return `
    <div class="mode-switch ${mode === 'edit' ? 'edit' : ''}">
      <button data-mode="read" class="${mode === 'read' ? 'on' : ''}">阅读模式</button>
      <button data-mode="edit" class="${mode === 'edit' ? 'on' : ''}">编辑模式</button>
    </div>
    <span class="readonly-banner">${mode === 'edit'
      ? `<i class="dirty-dot"></i>编辑中${dirty ? ' · 有未保存改动' : ''}`
      : '只读 · 任何修改都不会自动写入磁盘'}</span>
    <span class="hint" id="noteStat" title="按非空白字符数算，约 300 字 / 分钟">${statLine(text)}</span>
    <span class="grow"></span>
    <button class="btn sm" id="btnOutline">大纲</button>
    <button class="btn sm" id="btnExportNote" title="把整篇导出成 md">导出整篇</button>
    <button class="btn sm" id="btnExportAI">导出给 AI</button>
    <button class="btn sm" id="btnOutlineOnly">仅大纲</button>
    <button class="btn sm" id="btnOpenCursor" title="用本机 Cursor 打开当前笔记${focusSec ? '并跳到「' + esc(focusSec) + '」那一行' : ''}">在 Cursor 中打开</button>
    <button class="btn sm" id="btnMerge">AI 回填</button>
    <button class="btn sm danger" id="btnTrash" title="内容先存进中间文件目录的回收站，再从文件夹里移除">删除</button>
    <button class="btn sm ${dirty ? 'primary' : ''}" id="btnSave" ${dirty ? '' : 'disabled'}>保存到磁盘</button>
  `;
}

/* 阅读时把相对路径的图片换成 blob URL（用完回收） */
const objectUrls = [];
let renderSeq = 0;          // 每次渲染 +1：用来判断异步读图的结果是否已经过期
async function hydrateImages() {
  const view = document.querySelector('#view');
  if (!view || srcKey() !== 'fsa' || !current) return;
  const mySeq = renderSeq;
  const dirOfNote = current.path.includes('/') ? current.path.slice(0, current.path.lastIndexOf('/')) : '';
  for (const img of [...view.querySelectorAll('.mdview img')]) {
    const src = img.getAttribute('src') || '';
    if (!src || /^(https?:|data:|blob:)/i.test(src)) continue;
    const full = ((dirOfNote ? dirOfNote + '/' : '') + src.replace(/^\.\//, ''));
    const slash = full.lastIndexOf('/');
    const parent = slash >= 0 ? full.slice(0, slash) : '';
    const name = slash >= 0 ? full.slice(slash + 1) : full;
    const url = await fsa.blobUrlFor(slot, parent, name);
    if (!url) continue;
    // 等读完这段时间里已经重新渲染过（切了笔记/重新加载），这个 URL 直接丢掉，避免写错节点和泄漏
    if (mySeq !== renderSeq) { try { URL.revokeObjectURL(url); } catch {} continue; }
    objectUrls.push(url);
    img.src = url;
  }
}

function render() {
  renderSeq++;
  objectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
  objectUrls.length = 0;
  const root = document.querySelector('#view');
  const recent = recentList();
  // 当前打开的排最前，其次上次看过的，其余按「最近修改」倒序（还没读到时间的按名称）
  const uiNow = store.notesSlotUI(slot);
  const rank = p => (current && p === current.path ? 0 : p === uiNow.last ? 1 : 2);
  const ql = String(query || '').toLowerCase();
  const bodyCache = uiNow.textCache || {};
  const visibleFiles = (ql
    ? files.filter(f => f.path.toLowerCase().includes(ql)
      // 正文缓存只在打开过的笔记里有，搜不到的就当没命中，别假装搜了整库
      || String((bodyCache[f.path] && bodyCache[f.path].t) || '').toLowerCase().includes(ql))
    : files.slice())
    .sort((a, b) => {
      const ra = rank(a.path), rb = rank(b.path);
      if (ra !== rb) return ra - rb;
      if (ra !== 2) return 0;
      const d = (b.mtime || 0) - (a.mtime || 0);
      return d !== 0 ? d : a.path.localeCompare(b.path, 'zh');
    });

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
          <input type="text" id="nq" placeholder="搜文件名，也能搜打开过的正文" value="${esc(query)}">
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
                ` : `<div class="mdview">${renderSections()}</div>
                     ${backlinksHTML()}`}
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
  draftSave();
  const b = document.querySelector('#btnSave');
  if (b) { b.disabled = false; b.classList.add('primary'); }
  const badge = document.querySelector('.readonly-banner');
  if (badge) badge.innerHTML = '<i class="dirty-dot"></i>编辑中 · 有未保存改动';
  const stat = document.querySelector('#noteStat');
  if (stat) stat.textContent = statLine(text);
}

/* 编辑模式下粘贴图片：存到笔记旁边的 assets/，正文插入相对路径 */
let pasteBound = false;
function bindPaste(root) {
  if (pasteBound) return;
  pasteBound = true;
  root.addEventListener('paste', async e => {
    const ta = e.target;
    if (!ta || ta.id !== 'mdCode') return;
    const img = [...((e.clipboardData && e.clipboardData.files) || [])].find(f => /^image\//.test(f.type));
    if (!img) return;
    e.preventDefault();
    if (srcKey() !== 'fsa') { toast('内置笔记库不支持粘贴图片，请先连接本地文件夹', 'warn'); return; }
    try {
      const ext = String(img.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const name = 'paste-' + Date.now() + '.' + ext;
      const dirOfNote = current.path.includes('/') ? current.path.slice(0, current.path.lastIndexOf('/')) : '';
      const rel = (dirOfNote ? dirOfNote + '/' : '') + 'assets/' + name;
      await fsa.writeBinary(slot, (dirOfNote ? dirOfNote + '/' : '') + 'assets', name, img);
      const pos = ta.selectionStart;
      const md = `![](${rel})`;
      ta.value = ta.value.slice(0, pos) + md + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = pos + md.length;
      sync();                        // 同步文本、脏标记与本地草稿
      toast('图片已存到 assets/，保存笔记后长期生效', 'ok');
    } catch (err) { toast(err.message || '粘贴图片失败', 'warn'); }
  });
}

/* 点正文里的图片放大看 */
let imgBound = false;
function bindImageZoom(root) {
  if (imgBound) return;
  imgBound = true;
  root.addEventListener('click', e => {
    const img = e.target && e.target.closest ? e.target.closest('.mdview img') : null;
    if (!img) return;
    modal({
      title: '查看图片', wide: true, okText: '关闭', cancelText: '关闭',
      body: `<div style="text-align:center"><img src="${esc(img.src)}" style="max-width:100%;max-height:70vh;border-radius:6px"></div>`
    });
  });
}

function wire() {
  const root = document.querySelector('#view');
  hydrateImages().catch(() => { });
  bindPaste(root);
  bindImageZoom(root);

  // [[笔记名]] 双链：当前槽位里按名字找，找到就打开，找不到给个提示
  root.querySelectorAll('.wikilink').forEach(a => a.addEventListener('click', async e => {
    e.preventDefault();
    const n = a.dataset.wiki;
    const hit = () => files.find(x => x.name.replace(/\.md$/i, '') === n || x.path === n);
    let f = hit();
    if (!f) {
      // 本槽位没有就去另一个槽位找，找到就顺手切过去
      const from = slot;
      await switchSlot(from === 'work' ? 'know' : 'work');
      f = hit();
      if (!f) {
        await switchSlot(from);
        toast('两个笔记库里都没有《' + n + '》', 'warn');
        return;
      }
    }
    openFile(f);
  }));

  // Ctrl/Cmd+S 直接保存（wire 每次渲染都会跑，用模块级标记避免重复绑定）
  if (!saveKeyBound) {
    saveKeyBound = true;
    document.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 's' && e.key !== 'S')) return;
      if (document.querySelector('#mdCode') === null) return;    // 不在编辑模式
      e.preventDefault();
      if (dirty) doSave();
    });
  }

  root.querySelectorAll('[data-back]').forEach(el => el.addEventListener('click', () => {
    const f = files.find(x => x.path === el.dataset.back);
    if (f) openFile(f);
  }));

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
      draftClear(current && current.path);
    }
    mode = next; render();
  }));

  const saveBtn = root.querySelector('#btnSave');
  if (saveBtn) saveBtn.addEventListener('click', doSave);

  // 删除：磁盘笔记先写一份到中间文件目录的回收站，再从源文件夹移除
  const trashBtn = root.querySelector('#btnTrash');
  if (trashBtn) trashBtn.addEventListener('click', async () => {
    if (!current) return;
    const target = current;
    if (!(await confirmBox('删除笔记',
      `把《${target.name}》移到「回收站」？\n\n内容会先复制一份到中间文件目录，再从原来的文件夹里移除，事后能找回来。`,
      '移到回收站'))) return;
    try {
      const rel = await trashSafe(target);
      if (!rel) return;                      // 用户没选目录 / 取消了
      dirty = false;
      draftClear(target.path);
      if (current && current.path === target.path) { current = null; text = ''; mode = 'read'; }
      await loadFiles();
      render();
      toast(srcKey() === 'fsa' ? `已移到「${rel}」` : '已从内置库删除', 'ok');
    } catch (e) {
      toast('删除失败：' + ((e && e.message) || e), 'warn', 5000);
    }
  });
  const bo = root.querySelector('#btnOutline');
  if (bo) bo.addEventListener('click', () => { outlineOnly = !outlineOnly; render(); });
  const bea = root.querySelector('#btnExportAI');
  if (bea) bea.addEventListener('click', () => exportToAI('full'));
  const ben = root.querySelector('#btnExportNote');
  if (ben) ben.addEventListener('click', exportWhole);
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
    // 导出不算「常看」：这里原来也 bumpRecent，导几章就把首页「最近常看的笔记」刷成它了
    exportChapter(sec);
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
  // 上次那篇被改名/删掉了，或者第一次进来：直接打开第一篇，别让人对着空编辑器猜下一步
  const f = files.find(x => x.path === last) || files[0];
  if (f) await openFile(f);
  else render();
}

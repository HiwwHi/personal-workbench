import * as store from './store.js';
import * as fsa from './fsa.js';
import * as M from './model.js';
import { today, dateAdd } from './ui.js';

/* ------------------------------------------------------------------ 客户端封装 */

/* 本机令牌：服务端启动时随机生成并写进页面 meta，本机其它程序拿不到 */
function token() {
  const m = document.querySelector('meta[name="wb-token"]');
  return m ? m.getAttribute('content') : '';
}

async function post(url, body) {
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WB-Token': token() },
      body: JSON.stringify(body || {})
    });
  } catch {
    throw new Error('连不上本机服务（127.0.0.1），确认工作台服务还在运行');
  }
  let j;
  try { j = await r.json(); } catch { throw new Error('本机服务返回了异常响应（HTTP ' + r.status + '）'); }
  if (!r.ok || j.error) {
    const err = new Error(j.error || ('HTTP ' + r.status));
    err.status = r.status;
    err.data = j;          // 服务端可能在 403 里带 needsRoot，供上层弹确认框
    throw err;
  }
  return j;
}

/** 登记信任目录；mkdir=true 时要求服务端先创建该目录再登记 */
export async function addRoot(p, { mkdir = false } = {}) {
  if (!p) throw new Error('缺少目录');
  const r = await post('/api/roots', { add: [p], mkdir });
  // 服务端拒绝的目录会放在 rejected 里（整块磁盘、系统目录、不存在的路径）
  if ((r.rejected || []).length) {
    throw new Error('目录不可登记：必须是已存在的文件夹，且不能是系统目录或整块磁盘');
  }
  return r.roots || [];
}

export async function registerRoots() {
  const dirs = [];
  try { dirs.push(await fsa.currentDir('work')); } catch {}
  try { dirs.push(await fsa.currentDir('know')); } catch {}
  try { dirs.push(await fsa.runtimePath()); } catch {}
  // 只登记拿到绝对路径的目录：服务端要靠它校验越界
  const roots = dirs.filter(Boolean).map(d => d.root).filter(Boolean);
  if (!roots.length) return [];
  // 不吞异常：登记失败要让调用方 toast 出来
  const r = await post('/api/roots', { add: roots });
  return r.roots || [];
}

/** 在资源管理器里定位目标 */
export async function revealInExplorer(target) {
  if (!target) throw new Error('缺少目标路径');
  return post('/api/shell', { op: 'reveal-in-explorer', payload: { target } });
}

export async function openInEditor({ app = 'cursor', target, line } = {}) {
  if (!target) throw new Error('缺少 target');
  return post('/api/open', { app, target, line });
}

export async function installCursorUserSkills(skills) {
  return post('/api/shell', {
    op: 'install-cursor-user-skills',
    payload: { skills: skills.map(s => ({ name: s.name, content: s.content })) }
  });
}

export async function revealCursorUserConfig() {
  return post('/api/shell', { op: 'reveal-cursor-user-config' });
}

/* ------------------------------------------------------------------ 工作台现状快照 */

function fmtTask(t, mod, proj) {
  const due = t.due || '—';
  const who = mod && mod.owner ? `（@${mod.owner}）` : '';
  const st = t.done ? '✅' : (t.due && t.due < today() ? '⚠️ 逾期' : '⬜');
  return `- ${st} **${escMd(t.title)}** · 截止 ${due} · 项目《${escMd(proj.name)}》/${escMd(mod ? mod.name : '未分模块')} ${who}`;
}

function escMd(s) {
  return String(s == null ? '' : s).replace(/[\\`*_{}\[\]()#+\-.!]/g, m => '\\' + m).replace(/\n/g, ' ');
}

export function buildSnapshot() {
  const d = store.load();
  const T = today();
  const tasks = M.allTasks();
  const todayList = tasks.filter(x => !x.task.done && x.task.due === T);
  const overList = tasks.filter(x => !x.task.done && x.task.due && x.task.due < T);
  const upList = tasks.filter(x => !x.task.done && x.task.due && x.task.due > T && x.task.due <= dateAdd(7))
    .sort((a, b) => a.task.due.localeCompare(b.task.due));

  const projectBlocks = d.projects.map(p => {
    const total = (p.tasks || []).length;
    const done = (p.tasks || []).filter(t => t.done).length;
    const pct = total ? Math.round(done / total * 100) : 0;
    const ts = (p.tasks || []).slice(0, 10).map(t => {
      const mod = (p.modules || []).find(m => m.id === t.moduleId);
      return fmtTask(t, mod, p);
    }).join('\n');
    const mods = (p.modules || []).map(m => {
      const mt = (p.tasks || []).filter(x => x.moduleId === m.id);
      const md = mt.filter(x => x.done).length;
      return `  - ${escMd(m.name)}${m.owner ? ' · @' + escMd(m.owner) : ''} · ${md}/${mt.length} 完成`;
    }).join('\n');
    return `### 《${p.name}》  ${done}/${total} 完成（${pct}%）\n${p.owner ? '负责人：@' + escMd(p.owner) + '\n' : ''}${mods ? '模块：\n' + mods + '\n' : ''}${ts ? '任务（前 10）：\n' + ts : '（暂无任务）'}`;
  }).join('\n\n');

  const study = d.study.map(s => {
    const ck = s.checkins || {};
    const t7 = [0,1,2,3,4,5,6].map(o => dateAdd(-o)).reverse().map(dt => ck[dt] ? '●' : '○').join('');
    return `- 《${escMd(s.name)}》 · 阶段 ${(s.stages||[]).filter(x=>x.done).length}/${(s.stages||[]).length} · 近 7 天 ${t7}`;
  }).join('\n') || '_暂无_';

  const skills = d.skills.map(k => `- **${escMd(k.name)}** · 触发：${escMd(k.trigger || '-')} · ${escMd(k.desc || '')}`).join('\n') || '_暂无_';

  const jots = (d.jots || []).slice(0, 5)
    .map(j => `- [${new Date(j.createdAt || j.at || Date.now()).toLocaleDateString('zh-CN')}] ${escMd(j.text || '')}`).join('\n') || '_暂无_';

  return `# 工作台现状快照 · ${new Date().toLocaleString('zh-CN')}

> 这是我在 ${T} 的工作台状态。给我提建议、整理任务、规划时间都可以基于这份数据。
> 数据来自本地浏览器 localStorage（端口 8733）。修改建议请返回结构化文本，我会人工 review 后再落盘。

## 今日待办（${todayList.length}）

${todayList.map(x => fmtTask(x.task, x.module, x.project)).join('\n') || '_暂无_'}

## 逾期（${overList.length}）

${overList.map(x => fmtTask(x.task, x.module, x.project)).join('\n') || '_暂无_'}

## 未来 7 天（${upList.length}）

${upList.map(x => fmtTask(x.task, x.module, x.project)).join('\n') || '_暂无_'}

## 项目进度

${projectBlocks || '_暂无项目_'}

## 学习计划

${study}

## 工作 Skill（${d.skills.length} 个）

${skills}

## 最近随手记

${jots}

---
_自动生成于工作台系统设置页 · 「AI 联动」_
`;
}

export async function saveSnapshot() {
  if (!await fsa.runtimeReady()) throw new Error('未设置中间文件目录');
  const text = buildSnapshot();
  const name = '工作台现状-' + today() + '.md';
  return fsa.writeRuntime('给AI看', name, text);
}

export async function openSnapshot() {
  await saveSnapshot();
  const dir = await fsa.runtimePath();
  if (!dir) throw new Error('中间文件目录未设置');
  const root = await fsa.ensureAbsPath('runtime');
  return openInEditor({ app: 'cursor', target: root + '\\给AI看' });
}
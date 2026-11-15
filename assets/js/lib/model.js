import * as store from './store.js';
import { today, dateAdd } from './ui.js';

export function projects() { return store.load().projects; }

export function allTasks() {
  const out = [];
  for (const p of projects()) {
    for (const t of (p.tasks || [])) {
      const mod = (p.modules || []).find(m => m.id === t.moduleId);
      out.push({ task: t, project: p, module: mod || null });
    }
  }
  return out;
}

/* 周一为一周起点，和日历视图的列顺序一致 */
function weekStart(date) {
  const d = new Date(date + 'T00:00:00');
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  return dateAdd(-(dow - 1), date);
}

/* date 默认今天：传了日期就按那天判断（日历视图要靠它显示正确勾选态） */
export function isDone(t, date) {
  const d = typeof date === 'string' && date ? date : today();
  if (t.repeat === 'daily') return t.lastDone === d;
  if (t.repeat === 'weekly') return !!t.lastDone && weekStart(t.lastDone) === weekStart(d);
  return !!t.done;
}

export function dueToday() {
  const t = today();
  return allTasks().filter(x => !isDone(x.task) && x.task.due && x.task.due <= t);
}

export function overdue() {
  const t = today();
  // 重复任务按周期滚，不算逾期（否则每日任务第二天就永远是红的）
  return allTasks().filter(x => !isDone(x.task) && x.task.repeat !== 'weekly' && x.task.repeat !== 'daily' && x.task.due && x.task.due < t);
}

export function noDue() {
  return allTasks().filter(x => !isDone(x.task) && !x.task.due);
}

export function upcoming(days = 7) {
  const t = today(), end = dateAdd(days);
  return allTasks().filter(x => !isDone(x.task) && x.task.due && x.task.due > t && x.task.due <= end)
    .sort((a, b) => a.task.due.localeCompare(b.task.due));
}

export function historyOn(date) {
  const out = [];
  for (const x of allTasks()) {
    const hs = x.task.history || [];
    if (hs.some(h => (typeof h === 'string' ? h : h.date) === date)) out.push(x);
    else if (x.task.repeat === 'none' && x.task.done && String(x.task.doneAt || '').slice(0, 10) === date) out.push(x);
  }
  return out;
}

/* date 默认今天；日历视图点某天要记在那一天，不能都算到今天 */
export function toggleTask(projectId, taskId, date) {
  const d = typeof date === 'string' && date ? date : today();
  store.update(st => {
    const p = st.projects.find(x => x.id === projectId);
    if (!p) return;
    const task = (p.tasks || []).find(x => x.id === taskId);
    if (!task) return;
    task.history = task.history || [];
    if (isDone(task, d)) {
      if (task.repeat === 'none') { task.done = false; task.doneAt = null; }
      task.lastDone = null;
      task.history = task.history.filter(h => {
        const hd = typeof h === 'string' ? h : h.date;
        return task.repeat === 'weekly' ? weekStart(hd) !== weekStart(d) : hd !== d;
      });
    } else {
      if (task.repeat === 'none') { task.done = true; task.doneAt = new Date(d + 'T12:00:00').toISOString(); }
      task.lastDone = d;
      task.history.push({ date: d, at: new Date().toISOString() });
    }
  });
}

export function progress(p) {
  const ts = p.tasks || [];
  if (!ts.length) return 0;
  return Math.round(ts.filter(t => isDone(t)).length / ts.length * 100);
}

export function weeklyDone() {
  const t = today();
  let n = 0;
  for (let i = 0; i < 7; i++) n += historyOn(dateAdd(-i)).length;
  return n;
}

export function study() { return store.load().study; }

export function studyToday() {
  const t = today();
  return study().filter(s => (s.checkins || {})[t]);
}

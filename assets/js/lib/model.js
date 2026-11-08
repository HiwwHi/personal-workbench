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

export function isDone(t) {
  if (t.repeat === 'daily' || t.repeat === 'weekly') return t.lastDone === today();
  return !!t.done;
}

export function dueToday() {
  const t = today();
  return allTasks().filter(x => !isDone(x.task) && x.task.due && x.task.due <= t);
}

export function overdue() {
  const t = today();
  return allTasks().filter(x => !isDone(x.task) && x.task.due && x.task.due < t);
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

export function toggleTask(projectId, taskId) {
  const t = today();
  store.update(d => {
    const p = d.projects.find(x => x.id === projectId);
    if (!p) return;
    const task = (p.tasks || []).find(x => x.id === taskId);
    if (!task) return;
    task.history = task.history || [];
    if (isDone(task)) {
      if (task.repeat === 'none') { task.done = false; task.doneAt = null; }
      task.lastDone = null;
      task.history = task.history.filter(h => (typeof h === 'string' ? h : h.date) !== t);
    } else {
      if (task.repeat === 'none') { task.done = true; task.doneAt = new Date().toISOString(); }
      task.lastDone = t;
      task.history.push({ date: t, at: new Date().toISOString() });
    }
  });
}

export function progress(p) {
  const ts = p.tasks || [];
  if (!ts.length) return 0;
  return Math.round(ts.filter(isDone).length / ts.length * 100);
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

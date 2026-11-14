import * as store from './store.js';
import * as M from './model.js';
import { today, dateAdd } from './ui.js';

/* 报告区间：周报 = 本周一到今天，月报 = 本月 1 号到今天 */
export function rangeOf(kind = 'week') {
  const to = today();
  let from;
  if (kind === 'month') {
    from = to.slice(0, 8) + '01';
  } else {
    const d = new Date(to + 'T00:00:00');
    const dow = d.getDay() === 0 ? 7 : d.getDay();   // 周一=1 … 周日=7
    from = dateAdd(-(dow - 1), to);
  }
  const days = Math.max(1, Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1);
  return { from, to, days };
}

const mdEsc = s => String(s == null ? '' : s)
  .replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1')
  .replace(/\n/g, ' ');

function taskLine(x) {
  const mod = x.module ? ' / ' + mdEsc(x.module.name) : '';
  return `- ${mdEsc(x.task.title)}（《${mdEsc(x.project.name)}》${mod}）`;
}

export function build(kind = 'week') {
  const { from, to, days } = rangeOf(kind);
  const label = kind === 'month' ? '月报' : '周报';
  const d = store.load();

  /* 完成情况：按天扫，顺便拿到每天的完成清单 */
  const perDay = [];
  for (let i = 0; i < days; i++) {
    const ds = dateAdd(i, from);
    const list = M.historyOn(ds);
    if (list.length) perDay.push({ date: ds, list });
  }
  const doneCount = perDay.reduce((a, b) => a + b.list.length, 0);

  /* 学习打卡 */
  const study = (d.study || []).map(s => {
    const ck = s.checkins || {};
    let dayCount = 0, minutes = 0;
    for (let i = 0; i < days; i++) {
      const c = ck[dateAdd(i, from)];
      if (c) { dayCount++; minutes += Number(c.minutes) || 0; }
    }
    return {
      name: s.name, dayCount, minutes,
      stagesDone: (s.stages || []).filter(x => x.done).length,
      stagesTotal: (s.stages || []).length
    };
  }).filter(s => s.dayCount || s.minutes || s.stagesTotal);
  const studyDays = study.reduce((a, s) => a + s.dayCount, 0);
  const studyMinutes = study.reduce((a, s) => a + s.minutes, 0);

  /* 随手记 */
  const jots = (d.jots || []).filter(j => {
    const ds = String(j.createdAt || j.at || '').slice(0, 10);
    return ds >= from && ds <= to;
  });

  /* 健康 */
  const logs = (d.health && d.health.logs) || {};
  let water = 0, move = 0, eye = 0, hDays = 0;
  for (let i = 0; i < days; i++) {
    const l = logs[dateAdd(i, from)];
    if (!l) continue;
    const w = Number(l.water) || 0, m = Number(l.move) || 0, e = Number(l.eye) || 0;
    if (w + m + e > 0) hDays++;
    water += w; move += m; eye += e;
  }

  const over = M.overdue();
  const up = M.upcoming(7);
  const projects = (d.projects || []).map(p => ({
    name: p.name, pct: M.progress(p), total: (p.tasks || []).length,
    done: (p.tasks || []).filter(t => t.done).length
  }));

  const out = [];
  out.push(`# 工作台${label} · ${from} ~ ${to}`);
  out.push('');
  out.push('> 由「个人工作台」在本机生成，数据没有离开这台电脑。可以直接把这份内容丢给 Cursor / 任何 AI 让它帮你总结。');
  out.push('');

  out.push('## 概览');
  out.push('');
  out.push(`- 统计区间：${days} 天（${from} ~ ${to}）`);
  out.push(`- 有进展的天数：${perDay.length} / ${days}`);
  out.push(`- 完成任务：${doneCount} 个`);
  out.push(`- 学习打卡：${studyDays} 天，共 ${studyMinutes} 分钟`);
  out.push(`- 新增随手记：${jots.length} 条`);
  if (hDays) out.push(`- 健康记录：${hDays} 天有记录`);
  out.push('');

  out.push('## 完成的任务');
  out.push('');
  if (perDay.length) {
    for (const day of perDay) {
      out.push(`### ${day.date}`);
      out.push('');
      for (const x of day.list) out.push(taskLine(x));
      out.push('');
    }
  } else {
    out.push('_这段时间没有勾选完成的任务。_');
    out.push('');
  }

  out.push('## 项目进度');
  out.push('');
  if (projects.length) {
    for (const p of projects) out.push(`- 《${mdEsc(p.name)}》 ${p.done}/${p.total} 完成（${p.pct}%）`);
  } else {
    out.push('_还没有项目。_');
  }
  out.push('');

  out.push('## 学习计划');
  out.push('');
  if (study.length) {
    for (const s of study) {
      const stage = s.stagesTotal ? ` · 阶段 ${s.stagesDone}/${s.stagesTotal}` : '';
      out.push(`- 《${mdEsc(s.name)}》 打卡 ${s.dayCount} 天 · ${s.minutes} 分钟${stage}`);
    }
  } else {
    out.push('_这段时间没有学习记录。_');
  }
  out.push('');

  if (jots.length) {
    out.push('## 随手记');
    out.push('');
    for (const j of jots.slice(0, 30)) {
      const ds = String(j.createdAt || j.at || '').slice(0, 10);
      const text = String(j.text || '').replace(/\n/g, ' ').slice(0, 80);
      out.push(`- ${ds} ${mdEsc(text)}`);
    }
    if (jots.length > 30) out.push(`- …还有 ${jots.length - 30} 条`);
    out.push('');
  }

  if (hDays) {
    out.push('## 健康');
    out.push('');
    out.push(`- 喝水 ${water} 杯 · 起身 ${move} 次 · 护眼 ${eye} 次（${hDays} 天有记录）`);
    out.push('');
  }

  out.push('## 还没做完的');
  out.push('');
  out.push(`### 逾期（${over.length}）`);
  out.push('');
  if (over.length) for (const x of over.slice(0, 20)) out.push(taskLine(x) + ` · 截止 ${x.task.due}`);
  else out.push('_没有逾期任务。_');
  out.push('');
  out.push(`### 未来 7 天（${up.length}）`);
  out.push('');
  if (up.length) for (const x of up.slice(0, 20)) out.push(taskLine(x) + ` · 截止 ${x.task.due}`);
  else out.push('_未来 7 天没有排期。_');
  out.push('');
  out.push('---');
  out.push(`_生成于 ${new Date().toLocaleString('zh-CN')}_`);

  return out.join('\n');
}

export function fileName(kind = 'week') {
  const { to } = rangeOf(kind);
  return `工作台${kind === 'month' ? '月报' : '周报'}-${to}.md`;
}

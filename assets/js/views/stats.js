import * as store from '../lib/store.js';
import * as M from '../lib/model.js';
import { esc, dateAdd } from '../lib/ui.js';

export const meta = { key: 'stats', title: '数据统计', sub: '任务完成 · 项目进度 · 学习打卡' };

let range = 30;        // 柱状图统计天数：7 / 30 / 90

/* 近 n 天每天完成数：一次扫完历史，避免按天反复全表扫描。
   offset 用来取「再往前 n 天」，做同比用 */
function lastNDays(n, offset = 0) {
  const counts = {};
  for (const x of M.allTasks()) {
    const t = x.task;
    const seen = new Set();
    for (const h of (t.history || [])) {
      const d = typeof h === 'string' ? h : h.date;
      if (d) seen.add(d);
    }
    if (!seen.size && t.repeat === 'none' && t.done && t.doneAt) seen.add(String(t.doneAt).slice(0, 10));
    for (const d of seen) counts[d] = (counts[d] || 0) + 1;
  }
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = dateAdd(-(i + offset));
    out.push({ d, n: counts[d] || 0 });
  }
  return out;
}

export function mount(root) {
  const d = store.load();
  const all = M.allTasks();
  // 隐私模式下密码 / 随手记的入口都藏了，统计页还把它们「有几条」摆出来就不合适
  const hide = !!store.settings().privacy;
  const doneN = all.filter(x => M.isDone(x.task)).length;
  const todoN = M.dueToday().length;
  const overN = M.overdue().length;

  const days = lastNDays(range);
  const max = Math.max(1, ...days.map(x => x.n));
  const sumRange = days.reduce((a, b) => a + b.n, 0);
  // 最近 7 天 vs 此前 7 天：只看柱状图看不出「比上个月好还是差」
  const cur7 = lastNDays(7).reduce((a, b) => a + b.n, 0);
  const prev7 = lastNDays(7, 7).reduce((a, b) => a + b.n, 0);
  const delta = cur7 - prev7;
  const deltaText = delta === 0 ? '（持平）'
    : delta > 0 ? `，比此前 7 天多 <b style="color:var(--green)">${delta}</b> 项`
      : `，比此前 7 天少 <b style="color:var(--amber)">${-delta}</b> 项`;

  const study = d.study || [];
  let studyDays = 0;
  for (let i = 0; i < range; i++) {
    const ds = dateAdd(-i);
    if (study.some(s => (s.checkins || {})[ds])) studyDays++;
  }

  const prjs = (d.projects || []).map(p => ({
    name: p.name,
    pct: M.progress(p),
    total: (p.tasks || []).length,
    done: (p.tasks || []).filter(t => M.isDone(t)).length
  }));

  root.innerHTML = `
    <div class="grid grid-4 mb12">
      <div class="stat"><div class="stat-num">${all.length}</div><div class="stat-label">任务总数</div></div>
      <div class="stat"><div class="stat-num">${doneN}</div><div class="stat-label">已完成</div></div>
      <div class="stat"><div class="stat-num">${todoN}</div><div class="stat-label">今天要做</div></div>
      <div class="stat"><div class="stat-num" style="color:${overN ? 'var(--red)' : 'inherit'}">${overN}</div><div class="stat-label">已逾期</div></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <div class="card-title">近 ${range} 天完成</div>
          <span class="row" style="gap:4px">
            ${[7, 30, 90].map(n => `<button class="btn sm ${range === n ? 'primary' : ''}" data-range="${n}">${n} 天</button>`).join('')}
          </span>
        </div>
        <div style="display:flex;align-items:flex-end;gap:3px;height:110px">
          ${days.map(x => `<i title="${esc(x.d)} · ${x.n} 项" style="flex:1;height:${Math.round(x.n / max * 100)}%;min-height:2px;background:var(--green);opacity:${x.n ? 0.85 : 0.15};border-radius:2px"></i>`).join('')}
        </div>
        <div class="hint mt6">合计 <b>${sumRange}</b> 项 · 单日最高 <b>${max}</b> 项 · 近 ${range} 天学习打卡 <b>${studyDays}</b> 天</div>
        <div class="hint mt6">最近 7 天完成 <b>${cur7}</b> 项，此前 7 天 <b>${prev7}</b> 项${deltaText}</div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">项目完成率</div><span class="hint">${prjs.length} 个</span></div>
        ${prjs.length ? prjs.map(p => `
          <div class="mt12">
            <div class="row-between"><span>${esc(p.name)}</span><span class="hint">${p.done}/${p.total} · ${p.pct}%</span></div>
            <div class="progress"><i style="width:${p.pct}%"></i></div>
          </div>`).join('') : '<div class="empty">还没有项目</div>'}
      </div>
    </div>

    <div class="grid grid-3 mt12">
      <div class="stat"><div class="stat-num">${hide ? '—' : (d.jots || []).filter(j => !j.archived).length}</div><div class="stat-label">随手记</div></div>
      <div class="stat"><div class="stat-num">${hide ? '—' : (d.vault || []).length}</div><div class="stat-label">账号密码</div></div>
      <div class="stat"><div class="stat-num">${(d.skills || []).length}</div><div class="stat-label">Skill</div></div>
    </div>
    ${hide ? '<div class="hint mt6">隐私模式已开启，密码与随手记的数量不显示。</div>' : ''}
  `;

  root.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    range = Number(b.dataset.range) || 30;
    mount(root);
  }));
}

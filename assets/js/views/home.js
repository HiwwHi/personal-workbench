import * as store from '../lib/store.js';
import * as M from '../lib/model.js';
import * as fsa from '../lib/fsa.js';
import * as mdmod from '../lib/md.js';
import * as report from '../lib/report.js';
import * as health from '../lib/health.js';
import { esc, today, relDate, ring, modal, toast, download } from '../lib/ui.js';

export const meta = { key: 'home', title: '首页', sub: '' };

function recentNotes() {
  const all = [];
  ['work', 'know'].forEach(slot => {
    const r = store.notesSlotUI(slot).recent || {};
    Object.entries(r).forEach(([k, v]) => {
      const idx = k.indexOf('::');
      all.push({
        slot,
        note: idx < 0 ? k : k.slice(0, idx),
        section: idx < 0 ? '' : k.slice(idx + 2),
        count: v
      });
    });
  });
  return all.sort((a, b) => b.count - a.count).slice(0, 3);
}

export function mount(root) {
  const t = today();
  const dt = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()];
  const st = store.settings();

  const todayTasks = M.dueToday();
  const over = M.overdue();
  const wk = M.weeklyDone();
  const log = health.logOf(t);
  const hcount = (v, goal) => `${v}/${goal}`;

  const showHealth = !!st.homeHealth && !st.privacy;

  const cards = [];

  cards.push(`
    <div class="card">
      <div class="card-head">
        <div class="card-title">今日待办</div>
        <a class="btn sm" href="#/tasks">去任务管理</a>
      </div>
      ${todayTasks.length ? todayTasks.map(x => `
        <div class="list-item" style="padding-left:2px">
          <i class="check" data-prj="${x.project.id}" data-task="${x.task.id}"></i>
          <div class="grow">
            <div>${esc(x.task.title)}</div>
            <div class="hint">${esc(x.project.name)}${x.module ? ' · ' + esc(x.module.name) : ''}
              ${x.task.due && x.task.due < t ? ` · <span style="color:var(--red)">逾期 ${esc(x.task.due.slice(5))}</span>` : ''}
              ${x.task.repeat !== 'none' ? ' · 每日' : ''}
            </div>
          </div>
        </div>`).join('') : '<div class="empty">今天没有安排，清清爽爽 ✦</div>'}
    </div>`);

  if (showHealth) {
    cards.push(`
      <div class="card">
        <div class="card-head"><div class="card-title">今日健康</div><a class="btn sm" href="#/health">设置提醒</a></div>
        <div class="ring-row" style="justify-content:space-around">
          ${ring(Math.min(1, log.water / 6), 78, log.water, '喝水 ' + hcount(log.water, 6))}
          ${ring(Math.min(1, log.move / 5), 78, log.move, '起身 ' + hcount(log.move, 5))}
          ${ring(Math.min(1, log.eye / 8), 78, log.eye, '护眼 ' + hcount(log.eye, 8))}
        </div>
        <div class="hint mt12">今天已在电脑前约 ${Math.max(1, health.activeMinutes())} 分钟，${log.move >= 5 ? '起身目标已达成，不错' : '别忘了起来走走'}。</div>
      </div>`);
  }

  cards.push(`
    <div class="card">
      <div class="card-head"><div class="card-title">近期安排</div><span class="hint">未来 7 天</span></div>
      ${(() => {
      const up = M.upcoming(7);
      return up.length ? up.map(x => `
          <div class="list-item">
            <span class="tag ${x.task.due === t ? 'green' : 'blue'}">${esc(relDate(x.task.due))}</span>
            <div class="grow">
              <div>${esc(x.task.title)}</div>
              <div class="hint">${esc(x.project.name)}${x.module ? ' · 负责人 ' + esc(x.module.owner || '未指定') : ''}</div>
            </div>
          </div>`).join('') : '<div class="empty">近期暂无排期</div>';
    })()}
    </div>`);

  if (st.homeNotes) {
    const rs = recentNotes();
    cards.push(`
      <div class="card">
        <div class="card-head">
          <div class="card-title">最近常看的笔记</div>
          <a class="btn sm" href="#/notes">笔记库</a>
        </div>
        ${rs.length ? `<div class="recent-chips">${rs.map(r =>
      `<span class="recent-chip" data-slot="${r.slot}" data-note="${esc(r.note)}" data-sec="${esc(r.section)}">
            ${r.slot === 'know' ? '<span class="tag">知识</span>' : ''}${esc(r.section || r.note.split('/').pop())}
            <span class="hint">${r.count} 次</span></span>`).join('')}</div>`
        : '<div class="empty">还没有阅读记录，去「学习笔记」看看</div>'}
        <div class="hint mt12">最近三次点击最多的章节会出现在这里，点一下直接跳转</div>
      </div>`);
  }

  cards.push(`
    <div class="card">
      <div class="card-head"><div class="card-title">小结与报告</div><span class="hint">可直接丢给 AI 总结</span></div>
      <div class="hint mb12">周报统计本周一到今天，月报统计本月 1 号到今天。内容含完成的任务、项目进度、学习打卡、随手记与健康记录。</div>
      <div class="row wrap">
        <button class="btn primary sm" id="btnWeekly">生成周报</button>
        <button class="btn sm" id="btnMonthly">生成月报</button>
      </div>
    </div>`);

  if (!showHealth) {
    cards.push(`<div class="hint" style="grid-column:1/-1">健康提醒和统计已收进「健康管理」页，首页默认不显示（系统设置里可以打开）。</div>`);
  }

  root.innerHTML = `
    <div class="row-between mb12">
      <div>
        <div style="font-size:19px;font-weight:500">${esc(greet())}</div>
        <div class="hint">${t} 星期${week} · 今天也慢慢来</div>
      </div>
    </div>

    <div class="grid grid-4 mb12">
      <div class="stat"><div class="stat-num">${todayTasks.length}</div><div class="stat-label">今日待办</div></div>
      <div class="stat"><div class="stat-num" style="color:${over.length ? 'var(--red)' : 'inherit'}">${over.length}</div><div class="stat-label">已逾期</div></div>
      <div class="stat"><div class="stat-num">${M.upcoming(7).length}</div><div class="stat-label">未来 7 天</div></div>
      <div class="stat"><div class="stat-num">${wk}</div><div class="stat-label">近 7 天已完成</div></div>
    </div>

    <div class="grid grid-2">${cards.join('')}</div>
  `;

  root.querySelectorAll('.check').forEach(c => c.addEventListener('click', () => {
    M.toggleTask(c.dataset.prj, c.dataset.task);
    mount(root);
  }));

  root.querySelectorAll('.recent-chip').forEach(ch => ch.addEventListener('click', () => {
    store.update(d => {
      d.notesUI.pendingOpen = { slot: ch.dataset.slot, note: ch.dataset.note, section: ch.dataset.sec };
      d.settings.notesSlot = ch.dataset.slot;
    });
    location.hash = '#/notes';
  }));

  const bWeek = root.querySelector('#btnWeekly');
  if (bWeek) bWeek.addEventListener('click', () => reportModal('week'));
  const bMonth = root.querySelector('#btnMonthly');
  if (bMonth) bMonth.addEventListener('click', () => reportModal('month'));
}

/* 生成并预览报告；确认后落到「中间文件目录/报告/」，没有目录就下载 */
function reportModal(kind) {
  const label = kind === 'month' ? '月报' : '周报';
  const { from, to } = report.rangeOf(kind);
  const md = report.build(kind);
  const name = report.fileName(kind);
  modal({
    title: `工作台${label} · ${from} ~ ${to}`, wide: true,
    okText: '保存到中间文件目录',
    body: `<div class="hint mb8">文件名：<code>${esc(name)}</code> · ${md.split('\n').length} 行。保存位置：「中间文件目录/报告/」</div>
      <div class="hint mb12">想让它更有内容，先把这段复制给 AI，让它按你的语气改一版再存。</div>
      <div class="mdview" style="max-height:50vh;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:12px">${mdmod.render(md)}</div>`,
    onOk: async () => {
      try {
        await fsa.writeRuntime('报告', name, md);
        toast('已保存到「中间文件目录/报告/」', 'ok');
      } catch (e) {
        download(name, md, 'text/markdown;charset=utf-8');
        toast('中间文件目录不可用，已改为下载', 'warn');
      }
      return true;
    }
  });
}

function greet() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了，早点休息';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  if (h < 23) return '晚上好';
  return '夜深了';
}

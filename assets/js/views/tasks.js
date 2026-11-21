import * as store from '../lib/store.js';
import * as M from '../lib/model.js';
import { esc, uid, modal, toast, confirmBox, today, dateAdd, relDate } from '../lib/ui.js';

export const meta = { key: 'tasks', title: '任务管理', sub: '项目 · 模块负责人 · 日历回看' };

let tab = 'today';
let cal = null;
let selDate = today();
let prjFilter = '';          // 只看某个项目（空 = 全部）
let onlyOver = false;        // 今日列表只看逾期

function projectForm(p) {
  p = p || {};
  const mods = (p.modules || []).map(m => `${m.name} | ${m.owner || ''}`).join('\n');
  return `
    <label class="field"><span>项目名称</span><input type="text" data-f="name" value="${esc(p.name || '')}" placeholder="例：2 号线改造"></label>
    <div class="grid grid-2">
      <label class="field"><span>总负责人</span><input type="text" data-f="owner" value="${esc(p.owner || '')}"></label>
      <label class="field"><span>计划完成日</span><input type="date" data-f="due" value="${esc(p.due || '')}"></label>
    </div>
    <label class="field"><span>项目说明</span><textarea rows="2" data-f="desc">${esc(p.desc || '')}</textarea></label>
    <label class="field"><span>模块与对接负责人（每行一个，格式：模块名 | 负责人）</span>
      <textarea rows="4" data-f="modules" placeholder="需求分析 | 成员甲&#10;方案设计 | 成员乙&#10;开发实现 | 成员丙">${esc(mods)}</textarea></label>
  `;
}

function editProject(id, done) {
  const p = store.load().projects.find(x => x.id === id);
  modal({
    title: p ? '编辑项目' : '新建项目',
    body: projectForm(p),
    okText: '保存',
    done,
    onOk(body) {
      const g = f => body.querySelector('[data-f="' + f + '"]').value;
      if (!g('name').trim()) { toast('请填写项目名称', 'warn'); return false; }
      const modules = g('modules').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const [name, owner] = l.split('|').map(s => (s || '').trim());
        return { id: uid(), name: name || l, owner: owner || '' };
      });
      const keepOld = p ? (p.modules || []).filter(m => modules.some(n => n.name === m.name)) : [];
      const finalMods = modules.map(m => keepOld.find(k => k.name === m.name) || m);
      store.update(d => {
        const target = p ? d.projects.find(x => x.id === id) : null;
        if (target) {
          Object.assign(target, { name: g('name').trim(), owner: g('owner').trim(), due: g('due'), desc: g('desc').trim(), modules: finalMods });
          // 模块改名（会换新 id）或删掉后，任务上的 moduleId 成了悬空引用：清掉，按「未指定模块」显示
          const alive = new Set(finalMods.map(m => m.id));
          (target.tasks || []).forEach(tk => { if (tk.moduleId && !alive.has(tk.moduleId)) tk.moduleId = ''; });
        } else {
          d.projects.unshift({ id: uid(), name: g('name').trim(), owner: g('owner').trim(), due: g('due'), desc: g('desc').trim(), modules: finalMods, tasks: [], createdAt: today() });
        }
      });
      toast('已保存', 'ok');
      return true;
    }
  });
}

function taskForm(projectId, t) {
  const p = store.load().projects.find(x => x.id === projectId);
  t = t || {};
  return `
    <input type="hidden" data-f="projectId" value="${projectId}">
    <label class="field"><span>任务内容</span><input type="text" data-f="title" value="${esc(t.title || '')}"></label>
    <div class="grid grid-2">
      <label class="field"><span>所属模块</span>
        <select data-f="moduleId">
          <option value="">未指定</option>
          ${(p.modules || []).map(m => `<option value="${m.id}" ${m.id === t.moduleId ? 'selected' : ''}>${esc(m.name)}（${esc(m.owner || '未指定')}）</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>截止日</span><input type="date" data-f="due" value="${esc(t.due || '')}"></label>
    </div>
    <div class="grid grid-2">
      <label class="field"><span>重复</span>
        <select data-f="repeat">
          <option value="none" ${t.repeat === 'none' || !t.repeat ? 'selected' : ''}>不重复</option>
          <option value="daily" ${t.repeat === 'daily' ? 'selected' : ''}>每日任务</option>
          <option value="weekday" ${t.repeat === 'weekday' ? 'selected' : ''}>每个工作日</option>
          <option value="weekly" ${t.repeat === 'weekly' ? 'selected' : ''}>每周任务</option>
        </select>
      </label>
      <label class="field"><span>优先级</span>
        <select data-f="priority">
          <option value="normal">普通</option>
          <option value="high" ${t.priority === 'high' ? 'selected' : ''}>高</option>
        </select>
      </label>
    </div>
    ${!t.id ? '<div class="hint">留空截止日会进入「待安排」清单</div>' : ''}
  `;
}

function editTask(projectId, taskId, defaultDue, done) {
  const p = store.load().projects.find(x => x.id === projectId);
  if (!p) { toast('项目已不存在，刷新一下再试', 'warn'); return; }
  const t = taskId ? (p.tasks || []).find(x => x.id === taskId) : { due: defaultDue || '' };
  if (!t) { toast('任务已不存在，刷新一下再试', 'warn'); return; }
  modal({
    title: taskId ? '编辑任务' : '新增任务 · ' + p.name,
    body: taskForm(projectId, t),
    okText: '保存',
    done,
    onOk(body) {
      const g = f => body.querySelector('[data-f="' + f + '"]').value.trim();
      if (!g('title')) { toast('请填写任务内容', 'warn'); return false; }
      store.update(d => {
        const prj = d.projects.find(x => x.id === projectId);
        prj.tasks = prj.tasks || [];
        const target = taskId ? prj.tasks.find(x => x.id === taskId) : null;
        if (target) {
          Object.assign(target, {
            title: g('title'), moduleId: g('moduleId'), due: g('due'), repeat: g('repeat'), priority: g('priority')
          });
        } else {
          prj.tasks.push({
            id: uid(), title: g('title'), moduleId: g('moduleId'), due: g('due'),
            repeat: g('repeat'), priority: g('priority'), done: false, doneAt: null, lastDone: null, history: []
          });
        }
      });
      toast('已保存', 'ok');
      return true;
    }
  });
}

/* forDate：日历视图传入那一天，勾选态与逾期判定都按那天算 */
function taskRow(x, showPrj = true, forDate = '') {
  const t = x.task;
  const date = forDate || today();
  const done = M.isDone(t, date);
  const rep = t.repeat === 'weekly' ? ' · 每周重复'
    : t.repeat === 'weekday' ? ' · 每个工作日'
      : t.repeat === 'daily' ? ' · 每日重复' : '';
  const overNow = t.repeat === 'none' && t.due && t.due < date && !done;
  return `<div class="list-item" draggable="true" data-prj="${x.project.id}" data-task="${t.id}" title="可以拖到上面的项目卡片里换项目">
    <i class="check ${done ? 'on' : ''}" data-prj="${x.project.id}" data-task="${t.id}"${forDate ? ` data-date="${forDate}"` : ''}></i>
    <div class="grow">
      <div class="${done ? 'done-text' : ''}">${t.priority === 'high' ? '<span class="tag red">重要</span> ' : ''}${esc(t.title)}</div>
      <div class="hint">
        ${showPrj ? esc(x.project.name) + ' · ' : ''}${x.module ? esc(x.module.name) + ' · 对接 ' + (x.module.owner ? esc(x.module.owner) : '未指定') : '未指定模块'}
        ${t.due ? ' · ' + esc(relDate(t.due)) : ' · 待安排'}
        ${rep}
        ${overNow ? ' · <span style="color:var(--red)">已逾期</span>' : ''}
      </div>
    </div>
    <span class="actions">
      <button class="icon-btn" data-edit="${x.project.id}:${t.id}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
      <button class="icon-btn danger" data-del="${x.project.id}:${t.id}"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg></button>
    </span>
  </div>`;
}

function monthInfo() {
  if (!cal) { const d = new Date(); cal = { y: d.getFullYear(), m: d.getMonth() }; }
  return cal;
}

function calHtml() {
  const { y, m } = cal;
  const first = new Date(y, m, 1);
  const startPad = first.getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push('<div class="cal-cell pad"></div>');
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dueN = M.allTasks().filter(x => x.task.due === ds && !M.restsOn(x.task, ds)).length;
    const doneN = M.historyOn(ds).length;
    cells.push(`<div class="cal-cell ${ds === today() ? 'today' : ''} ${ds === selDate ? 'sel' : ''}" data-date="${ds}">
      <div class="cal-day">${d}</div>
      ${dueN ? `<div class="cal-mark"><i class="cal-dot"></i>${dueN} 项到期</div>` : ''}
      ${doneN ? `<div class="cal-mark" style="color:var(--text-3)">完成 ${doneN}</div>` : ''}
    </div>`);
  }
  return `<div class="cal-grid">
    ${['日', '一', '二', '三', '四', '五', '六'].map(d => `<div class="cal-head">${d}</div>`).join('')}
    ${cells.join('')}
  </div>`;
}

export function mount(root) {
  const prjs = store.load().projects;
  const t = today();
  // 项目被删（或恢复备份后 id 变了）时筛选值会悬空：列表空白、下拉却显示「全部项目」
  if (prjFilter && !prjs.some(p => p.id === prjFilter)) prjFilter = '';
  const overN = M.overdue().length;

  let body = '';
  if (tab === 'today') {
    const inP = x => !prjFilter || x.project.id === prjFilter;
    const todo = onlyOver ? M.overdue().filter(inP) : M.dueToday().filter(inP);
    const backlog = M.noDue().filter(inP).slice(0, 12);
    const done = M.historyOn(t).filter(inP);
    body = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-head">
            <div class="card-title">${onlyOver ? '已逾期' : '今天要做'}（${todo.length}）</div>
            ${todo.length && !onlyOver ? '<button class="btn-ghost sm" id="doneTodayAll">全部完成</button>' : ''}
          </div>
          ${todo.length ? todo.map(x => taskRow(x)).join('') : `<div class="empty">${onlyOver ? '没有逾期任务，保持住' : '今天没有到期任务'}</div>`}
        </div>
        <div>
          <div class="card">
            <div class="card-head"><div class="card-title">今天已完成（${done.length}）</div></div>
            ${done.length ? done.map(x => taskRow(x)).join('') : '<div class="empty">还没有勾选完成的任务</div>'}
          </div>
          <div class="card">
            <div class="card-head"><div class="card-title">待安排（无截止日）</div></div>
            ${backlog.length ? backlog.map(x => taskRow(x)).join('') : '<div class="empty">干净</div>'}
          </div>
        </div>
      </div>`;
  } else if (tab === 'upcoming') {
    const up = M.upcoming(7).filter(x => !prjFilter || x.project.id === prjFilter);
    const byDate = {};
    up.forEach(x => { (byDate[x.task.due] = byDate[x.task.due] || []).push(x); });
    body = Object.keys(byDate).length ? Object.keys(byDate).sort().map(d => `
      <div class="card">
        <div class="card-head"><div class="card-title">${esc(d)} · ${esc(relDate(d))}</div><span class="hint">${byDate[d].length} 项</span></div>
        ${byDate[d].map(x => taskRow(x)).join('')}
      </div>`).join('') : '<div class="card"><div class="empty">未来 7 天没有排期任务</div></div>';
  } else {
    const sel = M.historyOn(selDate).filter(x => !prjFilter || x.project.id === prjFilter);
    // 每个工作日任务在周末是「休息」，不该出现在这天的到期清单里（和「近期」口径一致）
    const due_sel = M.allTasks().filter(x => x.task.due === selDate && !M.restsOn(x.task, selDate) && (!prjFilter || x.project.id === prjFilter));
    body = `
      <div class="card">
        <div class="card-head">
          <div class="card-title">${cal.y} 年 ${cal.m + 1} 月</div>
          <div class="row">
            <button class="btn sm" data-mv="-1">上月</button>
            <button class="btn sm" data-mv="0">回本月</button>
            <button class="btn sm" data-mv="1">下月</button>
          </div>
        </div>
        ${calHtml()}
      </div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><div class="card-title">${selDate} · 当天已完成（${sel.length}）</div></div>
          ${sel.length ? sel.map(x => taskRow(x, true, selDate)).join('') : '<div class="empty">这天没有完成记录</div>'}
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">${selDate} · 到期任务</div>
            <button class="btn sm" data-add="sel">在此日新增</button></div>
          ${due_sel.length ? due_sel.map(x => taskRow(x, true, selDate)).join('') : '<div class="empty">这天没有到期任务</div>'}
        </div>
      </div>`;
  }

  root.innerHTML = `
    <div class="row-between mb12 wrap">
      <div class="row wrap grow">
        <button class="btn primary" id="newPrj"><svg viewBox="0 0 24 24" class="mini"><path d="M12 5v14M5 12h14"/></svg>新建项目</button>
        <button class="btn" id="newTask">快速新增任务</button>
        <select id="prjFilter" style="max-width:190px" title="只看某个项目">
          <option value="">全部项目</option>
          ${prjs.map(p => `<option value="${esc(p.id)}" ${prjFilter === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        <button class="btn sm ${onlyOver ? 'primary' : ''}" id="btnOver" title="只列出已经过了截止日的任务">只看逾期${overN ? `（${overN}）` : ''}</button>
      </div>
    </div>

    <div class="grid grid-cards mb12">
      ${prjs.length ? prjs.map(p => {
    const pr = M.progress(p);
    return `<div class="card" data-pid="${p.id}" style="padding:13px 14px">
          <div class="row-between">
            <div class="card-title">${esc(p.name)}</div>
            <span class="row">
              <button class="icon-btn" data-pedit="${p.id}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
              <button class="icon-btn danger" data-pdel="${p.id}"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg></button>
            </span>
          </div>
          <div class="hint mb8">${p.desc ? esc(p.desc) + ' · ' : ''}${p.owner ? '负责人 ' + esc(p.owner) : ''}${p.due ? ' · 截止 ' + esc(p.due) : ''}</div>
          <div class="progress"><i style="width:${pr}%"></i></div>
          <div class="row-between mt6">
            <span class="hint">${(p.tasks || []).filter(t => M.isDone(t)).length}/${(p.tasks || []).length} 项完成</span>
            <span class="row" style="gap:4px">
              <button class="btn-ghost sm" data-pdone="${p.id}">全部完成</button>
              <button class="btn-ghost sm" data-pclear="${p.id}">清除已完成</button>
              <button class="btn-ghost sm" data-tadd="${p.id}">+ 任务</button>
            </span>
          </div>
          ${(p.modules || []).length ? `<div class="mt12">${p.modules.map(m => `<span class="tag blue" style="margin:2px 4px 2px 0">${esc(m.name)} · ${esc(m.owner || '未指定')}</span>`).join('')}</div>` : ''}
        </div>`;
  }).join('') : '<div class="card"><div class="empty">还没有项目，先新建一个吧</div></div>'}
    </div>

    <div class="tabbar">
      <div class="tab ${tab === 'today' ? 'on' : ''}" data-tab="today">今日</div>
      <div class="tab ${tab === 'upcoming' ? 'on' : ''}" data-tab="upcoming">近期（7 天）</div>
      <div class="tab ${tab === 'cal' ? 'on' : ''}" data-tab="cal">日历</div>
    </div>
    ${body}
  `;

  // 拖拽：把任务拖到某个项目卡片上 = 移动到那个项目
  root.querySelectorAll('.list-item[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', el.dataset.prj + ':' + el.dataset.task);
      e.dataTransfer.effectAllowed = 'move';
    });
  });
  root.querySelectorAll('[data-pid]').forEach(card => {
    card.addEventListener('dragover', e => { e.preventDefault(); card.style.outline = '2px dashed var(--accent)'; });
    card.addEventListener('dragleave', () => { card.style.outline = ''; });
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.style.outline = '';
      const pid = card.dataset.pid;
      const raw = String(e.dataTransfer.getData('text/plain') || '');
      const [fromId, taskId] = raw.split(':');
      if (!pid || !fromId || !taskId || fromId === pid) return;
      let moved = '';
      store.update(d => {
        const from = d.projects.find(p => p.id === fromId);
        const to = d.projects.find(p => p.id === pid);
        if (!from || !to) return;
        const idx = (from.tasks || []).findIndex(t => t.id === taskId);
        if (idx < 0) return;
        const [task] = from.tasks.splice(idx, 1);
        // 目标项目里没有同 id 的模块就清掉模块归属，免得不显示
        if (task.moduleId && !(to.modules || []).some(m => m.id === task.moduleId)) task.moduleId = '';
        to.tasks = to.tasks || [];
        to.tasks.unshift(task);
        moved = to.name;
      });
      if (moved) { toast('已移动到「' + moved + '」', 'ok'); mount(root); }
    });
  });

  // 批量：整个项目一键完成 / 清掉已完成
  root.querySelectorAll('[data-pdone]').forEach(b => b.addEventListener('click', async () => {
    const p = store.load().projects.find(x => x.id === b.dataset.pdone);
    if (!p) return;
    const left = (p.tasks || []).filter(t => !M.isDone(t)).length;
    if (!left) { toast('这个项目没有未完成的任务', 'warn'); return; }
    if (!(await confirmBox('全部标记完成', `把《${p.name}》里 ${left} 个未完成任务都标记为完成？`, '全部完成'))) return;
    const d = today();
    store.update(st => {
      const pr = st.projects.find(x => x.id === p.id);
      (pr.tasks || []).forEach(t => {
        if (M.isDone(t)) return;
        t.history = t.history || [];
        if (t.repeat === 'none') { t.done = true; t.doneAt = new Date(d + 'T12:00:00').toISOString(); }
        t.lastDone = d;
        t.history.push({ date: d, at: new Date().toISOString() });
      });
    });
    toast('已全部标记完成', 'ok'); mount(root);
  }));

  root.querySelectorAll('[data-pclear]').forEach(b => b.addEventListener('click', async () => {
    const p = store.load().projects.find(x => x.id === b.dataset.pclear);
    if (!p) return;
    const done = (p.tasks || []).filter(t => M.isDone(t)).length;
    if (!done) { toast('这个项目没有已完成的任务', 'warn'); return; }
    if (!(await confirmBox('清除已完成任务', `删除《${p.name}》里 ${done} 个已完成任务？相关完成记录也会一起消失。`, '删除'))) return;
    store.update(st => {
      const pr = st.projects.find(x => x.id === p.id);
      if (pr) pr.tasks = (pr.tasks || []).filter(t => !M.isDone(t));
    });
    toast('已清除'); mount(root);
  }));

  const doneAll = root.querySelector('#doneTodayAll');
  if (doneAll) doneAll.addEventListener('click', async () => {
    const list = M.dueToday();
    if (!list.length) return;
    if (!(await confirmBox('今天全部完成', `把今天到期 / 逾期的 ${list.length} 个任务都标记为完成？`, '全部完成'))) return;
    const d = today();
    store.update(st => {
      for (const x of list) {
        const pr = st.projects.find(p => p.id === x.project.id);
        const t = pr && (pr.tasks || []).find(y => y.id === x.task.id);
        if (!t || M.isDone(t)) continue;
        t.history = t.history || [];
        if (t.repeat === 'none') { t.done = true; t.doneAt = new Date(d + 'T12:00:00').toISOString(); }
        t.lastDone = d;
        t.history.push({ date: d, at: new Date().toISOString() });
      }
    });
    toast('已全部完成', 'ok'); mount(root);
  });

  root.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => { tab = el.dataset.tab; if (tab === 'cal') monthInfo(); mount(root); }));
  root.querySelectorAll('.check').forEach(c => c.addEventListener('click', () => {
    M.toggleTask(c.dataset.prj, c.dataset.task, c.dataset.date || undefined);
    mount(root);
  }));
  root.querySelector('#newPrj').addEventListener('click', () => editProject(null, () => mount(root)));
  const pf = root.querySelector('#prjFilter');
  if (pf) pf.addEventListener('change', () => { prjFilter = pf.value; mount(root); });
  const bo = root.querySelector('#btnOver');
  if (bo) bo.addEventListener('click', () => { onlyOver = !onlyOver; mount(root); });

  root.querySelectorAll('[data-pedit]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); editProject(b.dataset.pedit, () => mount(root));
  }));
  root.querySelectorAll('[data-pdel]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const n = b.closest('.card').querySelector('.card-title').textContent;
    if (await confirmBox('删除项目', `删除「${n}」及其全部任务？`)) {
      store.update(d => { d.projects = d.projects.filter(x => x.id !== b.dataset.pdel); });
      toast('已删除'); mount(root);
    }
  }));
  root.querySelectorAll('[data-tadd]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); editTask(b.dataset.tadd, null, null, () => mount(root));
  }));
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const [p, t2] = b.dataset.edit.split(':'); editTask(p, t2, null, () => mount(root));
  }));
  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const [p, t2] = b.dataset.del.split(':');
    if (await confirmBox('删除任务', '确定删除这条任务？')) {
      store.update(d => {
        const prj = d.projects.find(x => x.id === p);
        if (prj) prj.tasks = (prj.tasks || []).filter(x => x.id !== t2);
      });
      toast('已删除'); mount(root);
    }
  }));

  const nt = root.querySelector('#newTask');
  if (nt) nt.addEventListener('click', () => {
    if (!prjs.length) { toast('请先新建项目', 'warn'); return; }
    modal({
      title: '快速新增任务', okText: '添加',
      body: `<label class="field"><span>归属项目</span><select data-f="pid">${prjs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
             <label class="field"><span>任务内容</span><input type="text" data-f="title"></label>
             <label class="field"><span>截止日</span><input type="date" data-f="due" value="${tab === 'cal' ? selDate : today()}"></label>`,
      onOk(body) {
        const gid = body.querySelector('[data-f="pid"]').value;
        const title = body.querySelector('[data-f="title"]').value.trim();
        const due = body.querySelector('[data-f="due"]').value;
        if (!title) { toast('请填写任务内容', 'warn'); return false; }
        store.update(d => {
          const prj = d.projects.find(x => x.id === gid);
          prj.tasks = prj.tasks || [];
          prj.tasks.push({ id: uid(), title, due, moduleId: '', repeat: 'none', priority: 'normal', done: false, doneAt: null, lastDone: null, history: [] });
        });
        toast('已添加', 'ok'); return true;
      },
      done: () => mount(root)
    });
  });

  root.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', () => {
    const v = Number(b.dataset.mv);
    if (v === 0) { const d = new Date(); cal = { y: d.getFullYear(), m: d.getMonth() }; }
    else {
      monthInfo();
      let nm = cal.m + v, ny = cal.y;
      if (nm < 0) { nm = 11; ny--; } if (nm > 11) { nm = 0; ny++; }
      cal = { y: ny, m: nm };
    }
    mount(root);
  }));
  root.querySelectorAll('.cal-cell[data-date]').forEach(c => c.addEventListener('click', () => { selDate = c.dataset.date; mount(root); }));
  const addSel = root.querySelector('[data-add="sel"]');
  if (addSel) addSel.addEventListener('click', () => {
    if (!prjs.length) { toast('请先新建项目', 'warn'); return; }
    editTask(prjs[0].id, null, selDate, () => mount(root));
  });
}

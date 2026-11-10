import * as store from '../lib/store.js';
import { esc, uid, modal, toast, confirmBox, today, dateAdd, relDate } from '../lib/ui.js';

export const meta = { key: 'study', title: '学习计划', sub: '目标 · 阶段 · 每日打卡' };

export function twoLimits(d) { return d; }

function form(s) {
  s = s || {};
  const stages = (s.stages || []).map(st => st.name).join('\n');
  return `
    <label class="field"><span>学习主题</span><input type="text" data-f="name" value="${esc(s.name || '')}" placeholder="例：拿下 CCIE 笔试"></label>
    <div class="grid grid-2">
      <label class="field"><span>目标完成日</span><input type="date" data-f="deadline" value="${esc(s.deadline || '')}"></label>
      <label class="field"><span>每日目标时长（分钟）</span><input type="number" data-f="goalMin" value="${esc(s.goalMin || 30)}"></label>
    </div>
    <label class="field"><span>阶段拆分（每行一个，从上到下递进）</span>
      <textarea rows="5" data-f="stages" placeholder="刷完教材前三章&#10;做完实验手册&#10;两套模拟题">${esc(stages)}</textarea></label>
  `;
}

function edit(id, done) {
  const s = store.load().study.find(x => x.id === id);
  modal({
    title: s ? '编辑学习计划' : '新建学习计划',
    body: form(s), okText: '保存',
    done,
    onOk(body) {
      const g = f => body.querySelector('[data-f="' + f + '"]').value;
      if (!g('name').trim()) { toast('请填写学习主题', 'warn'); return false; }
      const names = g('stages').split('\n').map(x => x.trim()).filter(Boolean);
      const old = (s && s.stages) || [];
      const stages = names.map(n => old.find(o => o.name === n) || { id: uid(), name: n, done: false });
      const data = {
        name: g('name').trim(), deadline: g('deadline'), goalMin: Number(g('goalMin')) || 30,
        stages, checkins: (s && s.checkins) || {}
      };
      store.update(d => {
        const t = s ? d.study.find(x => x.id === id) : null;
        if (t) Object.assign(t, data); else d.study.unshift(Object.assign({ id: uid(), createdAt: today() }, data));
      });
      toast('已保存', 'ok'); return true;
    }
  });
}

function heat() {
  const t = today();
  const all = store.load().study;
  const cols = [];
  let col = [];
  const startDate = new Date(t + 'T00:00:00');
  startDate.setDate(startDate.getDate() - (12 * 7 - 1) + (0));
  for (let i = 0; i < 12 * 7; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let mins = 0;
    all.forEach(s => { const c = (s.checkins || {})[ds]; if (c) mins += Number(c.minutes) || 0; });
    const lv = mins === 0 ? '' : mins <= 30 ? 'l1' : mins <= 60 ? 'l2' : mins <= 120 ? 'l3' : 'l4';
    col.push(`<div class="heat-cell ${lv} ${ds === t ? 'today' : ''}" title="${ds} · ${mins} 分钟"></div>`);
    if (col.length === 7) { cols.push(`<div class="heat-col">${col.join('')}</div>`); col = []; }
  }
  return `<div class="heat-grid">${cols.join('')}</div>`;
}

function checkin(s, done) {
  const t = today();
  const cur = (s.checkins || {})[t] || { minutes: s.goalMin || 30, note: '' };
  modal({
    title: '今日打卡 · ' + s.name, okText: '打卡',
    done,
    body: `<label class="field"><span>今天投入（分钟）</span><input type="number" data-f="minutes" value="${esc(cur.minutes)}"></label>
           <label class="field"><span>学到哪了 / 心得（选填）</span><textarea rows="3" data-f="note">${esc(cur.note)}</textarea></label>`,
    onOk(body) {
      const minutes = Number(body.querySelector('[data-f="minutes"]').value) || 0;
      const note = body.querySelector('[data-f="note"]').value.trim();
      store.update(d => {
        const x = d.study.find(y => y.id === s.id);
        x.checkins = x.checkins || {};
        x.checkins[t] = { minutes, note };
      });
      toast('打卡成功', 'ok'); return true;
    }
  });
}

export function mount(root) {
  const list = store.load().study;
  const t = today();
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = dateAdd(-i);
    const any = list.some(s => (s.checkins || {})[d]);
    if (any) streak++; else break;
  }

  root.innerHTML = `
    <div class="row-between mb12">
      <div class="hint">已连续打卡 <b style="color:var(--green)">${streak}</b> 天 · 今日已打卡 <b>${list.filter(s => (s.checkins || {})[t]).length}</b>/${list.length} 项</div>
      <button class="btn primary" id="snew"><svg viewBox="0 0 24 24" class="mini"><path d="M12 5v14M5 12h14"/></svg>新建学习计划</button>
    </div>

    <div class="card mb12">
      <div class="card-head"><div class="card-title">最近 12 周学习热力</div><span class="hint">颜色越深，当天投入越久</span></div>
      ${heat()}
    </div>

    ${list.length ? `<div class="grid grid-2">${list.map(s => {
    const done = (s.stages || []).filter(st => st.done).length;
    const pr = (s.stages || []).length ? Math.round(done / s.stages.length * 100) : 0;
    const checked = !!(s.checkins || {})[t];
    const totalMin = Object.values(s.checkins || {}).reduce((a, b) => a + (Number(b.minutes) || 0), 0);
    return `<div class="card" data-sid="${s.id}">
        <div class="row-between">
          <div class="card-title">${esc(s.name)}</div>
          <span class="row">
            <button class="icon-btn" data-sedit="${s.id}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
            <button class="icon-btn danger" data-sdel="${s.id}"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg></button>
          </span>
        </div>
        <div class="hint mb8">${s.deadline ? '目标 ' + esc(s.deadline) + ' · ' + esc(relDate(s.deadline)) + ' · ' : ''}累计 ${totalMin} 分钟</div>
        <div class="progress"><i style="width:${pr}%"></i></div>
        <div class="hint mt6">阶段完成 ${done}/${(s.stages || []).length}</div>
        <div class="stack mt12">
          ${(s.stages || []).map(st => `
            <div class="list-item" style="padding:4px 6px;margin-left:-6px">
              <i class="check ${st.done ? 'on' : ''}" data-stage="${st.id}"></i>
              <span class="${st.done ? 'done-text' : ''}">${esc(st.name)}</span>
            </div>`).join('') || '<div class="hint">还没拆分阶段，点右上角编辑可以添加</div>'}
        </div>
        <div class="row-between mt12">
          <span class="tag ${checked ? 'green' : ''}">${checked ? '今日已打卡 ' + (s.checkins[t].minutes || 0) + ' 分钟' : '今天还没打卡'}</span>
          <button class="btn sm ${checked ? '' : 'green'}" data-ci="${s.id}">${checked ? '补记' : '打卡'}</button>
        </div>
      </div>`;
  }).join('')}</div>` : '<div class="card"><div class="empty">还没有学习计划</div></div>'}
  `;

  root.querySelector('#snew').addEventListener('click', () => edit(null, () => mount(root)));
  root.querySelectorAll('[data-sedit]').forEach(b => b.addEventListener('click', () => edit(b.dataset.sedit, () => mount(root))));
  root.querySelectorAll('[data-sdel]').forEach(b => b.addEventListener('click', async () => {
    const n = b.closest('.card').querySelector('.card-title').textContent;
    if (await confirmBox('删除计划', `删除「${n}」及其全部打卡记录？`)) {
      store.update(d => { d.study = d.study.filter(x => x.id !== b.dataset.sdel); });
      toast('已删除'); mount(root);
    }
  }));
  root.querySelectorAll('[data-ci]').forEach(b => b.addEventListener('click', () => {
    const s = store.load().study.find(x => x.id === b.dataset.ci);
    checkin(s, () => mount(root));
  }));
  root.querySelectorAll('[data-stage]').forEach(c => c.addEventListener('click', () => {
    const sid = c.closest('.card').dataset.sid;
    store.update(d => {
      const s = d.study.find(x => x.id === sid);
      const st = s && (s.stages || []).find(x => x.id === c.dataset.stage);
      if (st) st.done = !st.done;
    });
    mount(root);
  }));
}

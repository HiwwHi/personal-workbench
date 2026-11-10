import * as store from '../lib/store.js';
import * as H from '../lib/health.js';
import { esc, modal, toast, ring, today, uid, confirmBox } from '../lib/ui.js';

export const meta = { key: 'health', title: '健康管理', sub: '轻量检测 · 不打断你的弱提醒' };

function ruleForm(r) {
  r = r || {};
  return `
    <label class="field"><span>提醒名称</span><input type="text" data-f="name" value="${esc(r.name || '')}" placeholder="例：喝水"></label>
    <div class="grid grid-2">
      <label class="field"><span>间隔（分钟）</span><input type="number" data-f="interval" value="${esc(r.interval || 30)}"></label>
      <label class="field"><span>是否在用</span>
        <select data-f="enabled">
          <option value="1" ${r.enabled === false ? '' : 'selected'}>启用</option>
          <option value="0" ${r.enabled === false ? 'selected' : ''}>停用</option>
        </select>
      </label>
    </div>
    <label class="field"><span>提醒文案（只在你专注时轻轻出现在右下角）</span>
      <input type="text" data-f="msg" value="${esc(r.msg || '')}" placeholder="起身接一杯水吧"></label>
  `;
}

export function mount(root) {
  H.ensureDefaults();
  const d = store.load().health;
  const log = H.logOf(today());

  root.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">今天的小目标</div><span class="hint">${today()}</span></div>
        <div class="ring-row" style="justify-content:space-around">
          ${ring(Math.min(1, log.water / 6), 84, log.water, '喝水 / 目标 6 杯')}
          ${ring(Math.min(1, log.move / 5), 84, log.move, '起身 / 目标 5 次')}
          ${ring(Math.min(1, log.eye / 8), 84, log.eye, '护眼 / 目标 8 次')}
        </div>
        <div class="row wrap mt12">
          <button class="btn sm green" data-add="water">+1 杯水</button>
          <button class="btn sm green" data-add="move">+1 次起身</button>
          <button class="btn sm green" data-add="eye">+1 次护眼</button>
        </div>
        <div class="hint mt12">今天在电脑前的累计时长约 <b>${H.activeMinutes()}</b> 分钟（从打开工作台开始算，每 20 秒统计一次；离开超过 5 分钟会自动暂停）。</div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">提醒规则</div>
          <button class="btn sm" id="hrNew">+ 新增规则</button>
        </div>
        ${d.rules.map(r => `
          <div class="rule-row" data-rid="${r.id}">
            <input type="checkbox" ${r.enabled ? 'checked' : ''} data-toggle="${r.id}" style="width:auto">
            <div class="grow">
              <div>${esc(r.name)} · 每 ${r.interval} 分钟</div>
              <div class="hint">${esc(r.msg || '（无文案）')}</div>
            </div>
            <span class="hint">${H.nextIn(r)} 分钟后</span>
            <button class="btn sm" data-test="${r.id}">试试</button>
            <button class="btn sm" data-reset="${r.id}">重新计时</button>
            <button class="icon-btn" data-redit="${r.id}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
            <button class="icon-btn danger" data-rdel="${r.id}"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg></button>
          </div>`).join('')}
        <label class="row mt12" style="font-size:13px;color:var(--text-2)">
          <input type="checkbox" id="hEnable" ${d.settings.enabled === false ? '' : 'checked'} style="width:auto;margin-right:6px">
          开启健康提醒（关掉后所有计时暂停）
        </label>
      </div>
    </div>

    <div class="card mt12">
      <div class="card-title mb8">它是怎么检测到你在电脑前的</div>
      <div class="eye-box">
        没有轮询、没有后台扫进程。工作台只在你移动鼠标、敲击键盘、滚动页面时更新一次「最后活跃时间」，并且做了 5 秒节流 ——
        也就是说最密集的操作下每 5 秒才记录一次，CPU 占用可以忽略不计。超过 5 分钟没有任何动静就认为你离开了，
        计时自动暂停，不会因为你去开会回来被一堆补提醒轰炸。
      </div>
      <div class="hint mt12">提醒方式是右下角一张淡入的小卡，15 秒后自己消失：<b>不抢输入焦点、不弹系统通知、不放提示音</b>。
        你可以点「已完成」记录一次，或者点「稍后 10 分钟」让它安静一会儿。</div>
    </div>
  `;

  root.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { H.bump(b.dataset.add); mount(root); }));
  root.querySelectorAll('[data-toggle]').forEach(c => c.addEventListener('change', () => {
    store.update(st => { st.health.rules.find(r => r.id === c.dataset.toggle).enabled = c.checked; });
    mount(root);
  }));
  root.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', () => {
    H.previewNotice(store.load().health.rules.find(r => r.id === b.dataset.test));
  }));
  root.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', () => { H.resetTimer(b.dataset.reset); toast('已重新开始计时'); mount(root); }));
  root.querySelectorAll('[data-redit]').forEach(b => b.addEventListener('click', () => {
    const r = store.load().health.rules.find(x => x.id === b.dataset.redit);
    modal({
      title: '编辑规则', body: ruleForm(r), okText: '保存',
      done: () => mount(root),
      onOk(body) {
        const g = f => body.querySelector('[data-f="' + f + '"]').value;
        if (!g('name').trim()) { toast('请填写名称', 'warn'); return false; }
        store.update(st => {
          Object.assign(st.health.rules.find(x => x.id === r.id), {
            name: g('name').trim(), interval: Math.max(1, Number(g('interval')) || 30),
            enabled: g('enabled') === '1', msg: g('msg').trim()
          });
        });
        toast('已保存', 'ok'); return true;
      }
    });
  }));
  root.querySelectorAll('[data-rdel]').forEach(b => b.addEventListener('click', async () => {
    const n = b.closest('.rule-row').querySelector('.card-title, div > div').textContent;
    if (await confirmBox('删除规则', `删除「${n.split('·')[0].trim()}」提醒？`)) {
      store.update(st => { st.health.rules = st.health.rules.filter(x => x.id !== b.dataset.rdel); });
      mount(root);
    }
  }));
  root.querySelector('#hrNew').addEventListener('click', () => {
    modal({
      title: '新增提醒规则', body: ruleForm({ interval: 60 }), okText: '添加',
      done: () => mount(root),
      onOk(body) {
        const g = f => body.querySelector('[data-f="' + f + '"]').value;
        if (!g('name').trim()) { toast('请填写名称', 'warn'); return false; }
        store.update(st => {
          st.health.rules.push({
            id: uid(), name: g('name').trim(), interval: Math.max(1, Number(g('interval')) || 30),
            enabled: g('enabled') === '1', msg: g('msg').trim()
          });
        });
        toast('已添加', 'ok'); return true;
      }
    });
  });
  root.querySelector('#hEnable').addEventListener('change', e => {
    store.update(st => { st.health.settings.enabled = e.target.checked; });
    toast(e.target.checked ? '健康提醒已开启' : '健康提醒已暂停');
  });
}

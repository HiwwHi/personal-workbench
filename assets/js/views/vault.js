import * as store from '../lib/store.js';
import { esc, uid, modal, toast, confirmBox, copyText, today } from '../lib/ui.js';

export const meta = { key: 'vault', title: '账号密码', sub: '明文保存在本机，请勿外传备份文件' };

let filter = { group: '全部', q: '' };

function items() { return store.load().vault; }

function groups() {
  const s = new Set(items().map(v => v.group || '未分组'));
  return ['全部', ...Array.from(s)];
}

function pwdAge(v) {
  if (!v.pwdChangedAt) return null;
  const days = Math.floor((Date.now() - new Date(v.pwdChangedAt + 'T00:00:00').getTime()) / 86400000);
  return days;
}

function formHTML(v) {
  v = v || {};
  return `
    <label class="field"><span>标题（账号 / 用途）</span><input type="text" data-f="title" value="${esc(v.title || '')}" placeholder="例：公司 VPN"></label>
    <label class="field"><span>分组</span><input type="text" data-f="group" value="${esc(v.group || '')}" placeholder="例：设备 / 服务器 / 后台"></label>
    <div class="grid grid-2">
      <label class="field"><span>账号</span><input type="text" data-f="account" value="${esc(v.account || '')}"></label>
      <label class="field"><span>密码</span><input type="text" data-f="password" value="${esc(v.password || '')}"></label>
    </div>
    <label class="field"><span>地址 / IP</span><input type="text" data-f="url" value="${esc(v.url || '')}"></label>
    <label class="field"><span>备注</span><textarea rows="2" data-f="note" placeholder="端口、默认网关、注意事项…">${esc(v.note || '')}</textarea></label>
  `;
}

function editEntry(id, done) {
  const v = items().find(x => x.id === id);
  modal({
    title: v ? '编辑条目' : '新增条目',
    body: formHTML(v),
    okText: '保存',
    done,
    onOk(body) {
      const g = f => body.querySelector('[data-f="' + f + '"]').value.trim();
      if (!g('title')) { toast('标题不能为空', 'warn'); return false; }
      const data = { title: g('title'), group: g('group') || '未分组', account: g('account'), password: g('password'), url: g('url'), note: g('note') };
      store.update(d => {
        if (v) Object.assign(d.vault.find(x => x.id === id), data, { updatedAt: today() });
        else d.vault.unshift(Object.assign({ id: uid(), createdAt: today(), pwdChangedAt: today() }, data));
      });
      toast(v ? '已更新' : '已添加', 'ok');
      return true;
    }
  });
}

function cardHTML(v, reveal) {
  const age = pwdAge(v);
  return `<div class="vault-card" data-id="${v.id}">
    <div class="row-between">
      <div class="vtitle">${esc(v.title)}</div>
      <span class="tag ${age && age > 180 ? 'amber' : 'blue'}">${esc(v.group || '未分组')}</span>
    </div>
    <div class="vault-field"><span class="k">账号</span><span class="v">${esc(v.account || '—')}</span>
      <button class="icon-btn" data-act="copy-acc" title="复制账号"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5H6a1 1 0 0 0-1 1v9"/></svg></button>
    </div>
    <div class="vault-field"><span class="k">密码</span><span class="v">${reveal.has(v.id) ? esc(v.password || '') : '••••••••'}</span>
      <button class="icon-btn" data-act="reveal" title="${reveal.has(v.id) ? '隐藏' : '显示'}"><svg viewBox="0 0 24 24"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/></svg></button>
      <button class="icon-btn" data-act="copy-pwd" title="复制密码"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5H6a1 1 0 0 0-1 1v9"/></svg></button>
    </div>
    ${v.url ? `<div class="vault-field"><span class="k">地址</span><span class="v">${esc(v.url)}</span></div>` : ''}
    ${v.note ? `<div class="hint" style="white-space:pre-wrap">${esc(v.note)}</div>` : ''}
    <div class="vault-foot">
      <span class="hint">${age === null ? '未记录改密时间' : age > 180 ? `<span style="color:var(--amber)">已 ${age} 天未改</span>` : `改密于 ${age} 天前`}</span>
      <span class="row">
        <button class="icon-btn" data-act="edit"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
        <button class="icon-btn danger" data-act="del"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg></button>
      </span>
    </div>
  </div>`;
}

const reveal = new Set();
let bound = false;

export function mount(root) {
  const all = items();
  const gps = groups();
  const list = all.filter(v => {
    if (filter.group !== '全部' && (v.group || '未分组') !== filter.group) return false;
    if (!filter.q) return true;
    const q = filter.q.toLowerCase();
    return [v.title, v.account, v.url, v.note, v.group].some(x => (x || '').toLowerCase().includes(q));
  });

  root.innerHTML = `
    <div class="row-between mb12 wrap">
      <div class="row wrap grow">
        <input type="text" id="vq" placeholder="搜索标题 / 账号 / 地址 / 备注" value="${esc(filter.q)}" style="max-width:280px">
        <select id="vg" style="max-width:150px">${gps.map(g => `<option ${g === filter.group ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
      </div>
      <div class="row">
        <button class="btn primary" id="vadd"><svg viewBox="0 0 24 24" class="mini"><path d="M12 5v14M5 12h14"/></svg>新增条目</button>
      </div>
    </div>
    ${list.length ? `<div class="grid grid-cards">${list.map(v => cardHTML(v, reveal)).join('')}</div>`
      : `<div class="card"><div class="empty">${all.length ? '没有匹配的条目' : '还没有保存任何账号，点右上角新增'}</div></div>`}
    <div class="hint mt12">密码在本机明文存储、默认打码显示。点「保存备份」导出的 JSON 里密码同样是明文，请妥善保管。</div>
  `;

  const q = root.querySelector('#vq');
  q.addEventListener('input', () => { filter.q = q.value; const p = q.selectionStart; mount(root); const n = root.querySelector('#vq'); n.focus(); n.setSelectionRange(p, p); });
  root.querySelector('#vg').addEventListener('change', e => { filter.group = e.target.value; mount(root); });
  root.querySelector('#vadd').addEventListener('click', () => editEntry(null, () => mount(root)));

  let clearTimer = null;
  async function smartCopy(text, tip) {
    const ok = await copyText(text);
    if (!ok) { toast('复制失败，请手动选择', 'warn'); return; }
    toast(tip, 'ok');
    const sec = Number(store.load().settings.clipboardClear || 15);
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { navigator.clipboard.writeText('').catch(() => { }); }, sec * 1000);
  }

  if (!bound) {
    bound = true;
    root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.vault-card');
    const v = items().find(x => x.id === card.dataset.id);
    switch (btn.dataset.act) {
      case 'reveal': reveal.has(v.id) ? reveal.delete(v.id) : reveal.add(v.id); mount(root); break;
      case 'copy-acc': smartCopy(v.account || '', '账号已复制，15 秒后自动清空剪贴板'); break;
      case 'copy-pwd': smartCopy(v.password || '', '密码已复制，15 秒后自动清空剪贴板'); break;
      case 'edit': editEntry(v.id, () => mount(root)); break;
      case 'del':
        if (await confirmBox('删除条目', `确定删除「${v.title}」？此操作不可撤销。`)) {
          store.update(d => { d.vault = d.vault.filter(x => x.id !== v.id); });
          toast('已删除'); mount(root);
        }
        break;
    }
    });
  }
}

import * as store from '../lib/store.js';
import { esc, uid, modal, toast, confirmBox, copyText, today } from '../lib/ui.js';

export const meta = { key: 'vault', title: '账号密码', sub: '明文保存在本机，请勿外传备份文件' };

let filter = { group: '', q: '' };   // group 空字符串表示"还没初始化"，挂载时从设置里读

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

/* 安全检查：只在本地算，不外传。阈值故意保守，只提示明显有问题的 */
const WEAK_MIN = 8;
const OLD_DAYS = 180;

function weakReason(pwd) {
  const s = String(pwd || '');
  if (!s) return '';
  if (s.length < WEAK_MIN) return '太短';
  if (/^\d+$/.test(s)) return '纯数字';
  if (/^[a-zA-Z]+$/.test(s)) return '纯字母';
  if (new Set(s).size <= 2) return '字符单一';
  return '';
}

function analyze(list) {
  const byPwd = new Map();
  for (const v of list) {
    const p = String(v.password || '');
    if (!p) continue;
    if (!byPwd.has(p)) byPwd.set(p, []);
    byPwd.get(p).push(v.id);
  }
  const dupIds = new Set();
  for (const ids of byPwd.values()) if (ids.length > 1) ids.forEach(id => dupIds.add(id));

  const issues = new Map();
  let weak = 0, dup = 0, old = 0;
  for (const v of list) {
    const arr = [];
    const w = weakReason(v.password);
    if (w) { arr.push({ text: '弱·' + w, cls: 'red' }); weak++; }
    if (dupIds.has(v.id)) { arr.push({ text: '重复使用', cls: 'red' }); dup++; }
    const age = pwdAge(v);
    if (age !== null && age > OLD_DAYS) { arr.push({ text: age + ' 天未换', cls: 'amber' }); old++; }
    if (arr.length) issues.set(v.id, arr);
  }
  return { issues, weak, dup, old };
}

/* 生成强密码：四类字符各抽一个再洗牌，避免出现纯字母/纯数字 */
function genPassword(len = 16) {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const num = '23456789';
  const sym = '!@#$%^&*-_=+';
  const all = lower + upper + num + sym;
  const rnd = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const arr = [lower[rnd(lower.length)], upper[rnd(upper.length)], num[rnd(num.length)], sym[rnd(sym.length)]];
  while (arr.length < len) arr.push(all[rnd(all.length)]);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

function formHTML(v) {
  v = v || {};
  return `
    <label class="field"><span>标题（账号 / 用途）</span><input type="text" data-f="title" value="${esc(v.title || '')}" placeholder="例：公司 VPN"></label>
    <label class="field"><span>分组</span><input type="text" data-f="group" value="${esc(v.group || '')}" placeholder="例：设备 / 服务器 / 后台"></label>
    <div class="grid grid-2">
      <label class="field"><span>账号</span><input type="text" data-f="account" value="${esc(v.account || '')}"></label>
      <label class="field"><span>密码</span>
        <div class="row">
          <input class="grow" type="text" data-f="password" value="${esc(v.password || '')}">
          <button type="button" class="btn sm" data-genpwd="1" title="生成 16 位随机密码">生成</button>
        </div>
      </label>
    </div>
    <label class="field"><span>地址 / IP</span><input type="text" data-f="url" value="${esc(v.url || '')}"></label>
    <label class="field"><span>备注</span><textarea rows="2" data-f="note" placeholder="端口、默认网关、注意事项…">${esc(v.note || '')}</textarea></label>
  `;
}

function editEntry(id, done) {
  const v = items().find(x => x.id === id);
  const m = modal({
    title: v ? '编辑条目' : '新增条目',
    body: formHTML(v),
    okText: '保存',
    done,
    onOk(body) {
      const g = f => body.querySelector('[data-f="' + f + '"]').value.trim();
      if (!g('title')) { toast('标题不能为空', 'warn'); return false; }
      const data = { title: g('title'), group: g('group') || '未分组', account: g('account'), password: g('password'), url: g('url'), note: g('note') };
      store.update(d => {
        const target = v ? d.vault.find(x => x.id === id) : null;
        if (target) {
          const pwdChanged = String(v.password || '') !== data.password;
          Object.assign(target, data, { updatedAt: today() });
          // 改了密码就重置「多少天未换」，否则这个提示永远消不掉
          if (pwdChanged) target.pwdChangedAt = today();
        } else if (!v) {
          d.vault.unshift(Object.assign({ id: uid(), createdAt: today(), pwdChangedAt: today() }, data));
        }
      });
      toast(v ? '已更新' : '已添加', 'ok');
      return true;
    }
  });

  const gen = m.body.querySelector('[data-genpwd]');
  if (gen) gen.addEventListener('click', () => {
    m.body.querySelector('[data-f="password"]').value = genPassword();
    toast('已生成 16 位随机密码，记得保存', 'ok');
  });
}

function cardHTML(v, reveal, issues) {
  const age = pwdAge(v);
  const marks = issues.get(v.id) || [];
  return `<div class="vault-card" data-id="${v.id}">
    <div class="row-between">
      <div class="vtitle">${esc(v.title)}</div>
      <span class="row" style="gap:4px">
        ${marks.map(m => `<span class="tag ${m.cls}">${esc(m.text)}</span>`).join('')}
        <span class="tag ${age && age > OLD_DAYS ? 'amber' : 'blue'}">${esc(v.group || '未分组')}</span>
      </span>
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
let clearTimer = null;      // 放模块级：重渲染后还要能取消上一次的清空定时器

export function mount(root) {
  const all = items();
  const gps = groups();
  if (!filter.group) filter.group = store.settings().vaultGroup || '全部';   // 记住上次看的分组
  // 分组被删或改名后，筛选值可能已不存在：不重置的话列表永久空白，下拉却显示「全部」
  if (filter.group !== '全部' && !gps.includes(filter.group)) filter.group = '全部';
  const chk = analyze(all);
  const flagTotal = chk.weak + chk.dup + chk.old;
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
    ${all.length ? `<div class="hint mb12">安全检查：${flagTotal
      ? `<b>${chk.weak}</b> 个弱密码 · <b>${chk.dup}</b> 个重复使用 · <b>${chk.old}</b> 个超过 ${OLD_DAYS} 天未改`
      : '没发现明显问题（弱密码 / 重复使用 / 长期未换）'}</div>` : ''}
    ${list.length ? `<div class="grid grid-cards">${list.map(v => cardHTML(v, reveal, chk.issues)).join('')}</div>`
      : `<div class="card"><div class="empty">${all.length ? '没有匹配的条目' : '还没有保存任何账号，点右上角新增'}</div></div>`}
    <div class="hint mt12">密码在本机明文存储、默认打码显示。点「保存备份」导出的 JSON 里密码同样是明文，请妥善保管。</div>
  `;

  const q = root.querySelector('#vq');
  q.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !q.value) return;      // Esc 清空搜索，少点一次全选删除
    filter.q = '';
    mount(root);
  });
  q.addEventListener('input', () => { filter.q = q.value; const p = q.selectionStart; mount(root); const n = root.querySelector('#vq'); n.focus(); n.setSelectionRange(p, p); });
  root.querySelector('#vg').addEventListener('change', e => {
    filter.group = e.target.value;
    store.setSetting('vaultGroup', filter.group);
    mount(root);
  });
  root.querySelector('#vadd').addEventListener('click', () => editEntry(null, () => mount(root)));

  async function smartCopy(text, what) {
    if (!String(text || '').trim()) { toast(`这条没有填${what}`, 'warn'); return; }
    const ok = await copyText(text);
    if (!ok) { toast('复制失败，请手动选择', 'warn'); return; }
    const raw = Number(store.load().settings.clipboardClear);
    const sec = Number.isFinite(raw) ? raw : 15;     // 0 表示不清空
    toast(sec > 0 ? `${what}已复制，${sec} 秒后自动清空剪贴板` : `${what}已复制`, 'ok');
    if (clearTimer) clearTimeout(clearTimer);
    if (sec > 0) {
      clearTimer = setTimeout(async () => {
        clearTimer = null;
        // 到点先确认剪贴板里还是刚才那条：这段时间用户可能已经复制了别的东西，别一起清掉
        try {
          const now = await navigator.clipboard.readText();
          if (now !== text) return;
        } catch (e) {
          // 读不到（浏览器没给读权限）就没法判断，仍然照原设定清掉：宁可误清别人的内容，也别把密码留在剪贴板
        }
        navigator.clipboard.writeText('').catch(() => { });
      }, sec * 1000);
    }
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
      case 'copy-acc': smartCopy(v.account || '', '账号'); break;
      case 'copy-pwd': smartCopy(v.password || '', '密码'); break;
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

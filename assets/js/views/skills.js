import * as store from '../lib/store.js';
import { esc, uid, modal, toast, confirmBox, copyText, download, today } from '../lib/ui.js';

export const meta = { key: 'skills', title: '工作 Skill', sub: '把重复工作标准化成可复用的执行流程' };

const PREFACE = `# AI 使用说明

下面是一份标准 Skill 定义。请你严格按照「执行步骤」逐项推进，并把结果按「输出模板」生成给我。
我会先看结果，确认无误后才落到正式文件里，不允许你直接改动我的磁盘文件。

---

`;

export function toSkillMd(s) {
  return `---
name: ${s.name}
description: ${s.description || ''}
---

# ${s.name}

## 触发场景
${s.trigger || '（未填写）'}

## 输入参数
${(s.inputs || []).length ? (s.inputs).map(i => `- **${i.name}**：${i.desc || ''}`).join('\n') : '- （无）'}

## 执行步骤
${(s.steps || []).map((st, i) => `${i + 1}. ${st.text}`).join('\n') || '（未填写）'}

## 输出模板
\`\`\`markdown
${s.template || '（未填写）'}
\`\`\`
`;
}

function form(s) {
  s = s || {};
  return `
    <label class="field"><span>Skill 名称</span><input type="text" data-f="name" value="${esc(s.name || '')}" placeholder="例：新项目上线检查清单"></label>
    <label class="field"><span>简介（一句话说明它干什么）</span><input type="text" data-f="description" value="${esc(s.description || '')}"></label>
    <label class="field"><span>触发场景（什么时候拿来用）</span><input type="text" data-f="trigger" value="${esc(s.trigger || '')}" placeholder="例：每次要把新设备接入内网时"></label>
    <label class="field"><span>输入参数（每行一个，格式：参数名 | 说明）</span>
      <textarea rows="3" data-f="inputs" placeholder="项目名称 | 例如 示例项目 A&#10;所属团队 | 例如 研发组">${esc((s.inputs || []).map(i => `${i.name} | ${i.desc || ''}`).join('\n'))}</textarea></label>
    <label class="field"><span>执行步骤（每行一步，按顺序执行）</span>
      <textarea rows="6" data-f="steps" placeholder="确认设备固件版本&#10;检查网段与 IP 是否冲突&#10;登记到资产台账">${esc((s.steps || []).map(st => st.text).join('\n'))}</textarea></label>
    <label class="field"><span>输出模板（AI 最终交付给你的格式）</span>
      <textarea rows="5" data-f="template" placeholder="## 检查结论&#10;- 设备：{{设备型号}}&#10;- 结论：">${esc(s.template || '')}</textarea></label>
  `;
}

function edit(id, done) {
  const s = store.load().skills.find(x => x.id === id);
  modal({
    title: s ? '编辑 Skill' : '新建 Skill', wide: true, okText: '保存',
    body: form(s),
    done,
    onOk(body) {
      const g = f => body.querySelector('[data-f="' + f + '"]').value;
      if (!g('name').trim()) { toast('请填写 Skill 名称', 'warn'); return false; }
      const oldSteps = (s && s.steps) || [];
      const inputs = g('inputs').split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => { const [name, ...rest] = l.split('|'); return { name: name.trim(), desc: rest.join('|').trim() }; });
      const steps = g('steps').split('\n').map(l => l.trim()).filter(Boolean)
        .map(text => oldSteps.find(o => o.text === text) || { id: uid(), text, done: false });
      const data = { name: g('name').trim(), description: g('description').trim(), trigger: g('trigger').trim(), inputs, steps, template: g('template'), updatedAt: today() };
      store.update(d => {
        const t = s ? d.skills.find(x => x.id === id) : null;
        if (t) Object.assign(t, data); else d.skills.unshift(Object.assign({ id: uid(), createdAt: today() }, data));
      });
      toast('已保存', 'ok'); return true;
    }
  });
}

function runModal(s, done) {
  const vals = {};
  (s.inputs || []).forEach(i => vals[i.name] = '');
  modal({
    title: '执行 · ' + s.name, wide: true, okText: '复制完整指令给 AI',
    done,
    body: `
      <div class="hint mb12">左边填参数，右边按步骤推进。最后可以一键把「AI 使用说明 + Skill 定义 + 已填参数」复制走，粘到对话里让 AI 照着做。</div>
      <div class="grid grid-2">
        <div>
          <div class="card-title mb8">输入参数</div>
          ${(s.inputs || []).length ? s.inputs.map(i => `
            <label class="field"><span>${esc(i.name)}${i.desc ? ' · ' + esc(i.desc) : ''}</span>
              <input type="text" data-in="${esc(i.name)}" placeholder="${esc(i.desc || '')}"></label>`).join('')
        : '<div class="hint">这个 Skill 没有输入参数</div>'}
        </div>
        <div>
          <div class="card-title mb8">执行步骤</div>
          <div class="skill-steps">
            ${(s.steps || []).map((st, i) => `
              <div class="skill-step ${st.done ? 'ok' : ''}">
                <i class="check ${st.done ? 'on' : ''}" data-step="${st.id}"></i>
                <span>${esc(st.text)}</span>
              </div>`).join('') || '<div class="hint">还没有步骤</div>'}
          </div>
          ${s.template ? `<div class="card-title mt16 mb8">输出模板预览</div><pre class="md-preview">${esc(fill(s.template, vals))}</pre>` : ''}
        </div>
      </div>`,
    onOk(body) {
      body.querySelectorAll('[data-in]').forEach(inp => vals[inp.dataset.in] = inp.value);
      const txt = PREFACE + toSkillMd(s) + '\n## 本次输入\n' +
        Object.entries(vals).map(([k, v]) => `- ${k}：${v || '（未填）'}`).join('\n') +
        '\n\n请按上面的步骤执行，并把结果按「输出模板」生成出来给我确认。';
      copyText(txt).then(ok => toast(ok ? '已复制到剪贴板，去对话里粘贴即可' : '复制失败', ok ? 'ok' : 'warn'));
      return true;
    }
  });
}

function fill(tpl, vals) {
  return String(tpl || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => vals[k] !== undefined && vals[k] !== '' ? vals[k] : m);
}

export function mount(root) {
  const list = store.load().skills;

  root.innerHTML = `
    <div class="row-between mb12">
      <div class="hint">Skill 会被导出成标准 SKILL.md 格式（YAML 头 + 步骤 + 输出模板），可以直接贴给 AI 让它照着执行</div>
      <button class="btn primary" id="sknew"><svg viewBox="0 0 24 24" class="mini"><path d="M12 5v14M5 12h14"/></svg>新建 Skill</button>
    </div>
    ${list.length ? `<div class="grid grid-cards">${list.map(s => {
    const done = (s.steps || []).filter(st => st.done).length;
    return `<div class="skill-card" data-sk="${s.id}">
        <div class="row-between">
          <div class="card-title">${esc(s.name)}</div>
          <span class="tag blue">${done}/${(s.steps || []).length} 步</span>
        </div>
        <div class="hint">${esc(s.description || '（没有简介）')}</div>
        ${s.trigger ? `<div><span class="tag amber">触发：${esc(s.trigger)}</span></div>` : ''}
        <div class="skill-steps">
          ${(s.steps || []).slice(0, 4).map((st, i) => `
            <div class="skill-step ${st.done ? 'ok' : ''}">
              <i class="n" data-step="${st.id}">${i + 1}</i><span>${esc(st.text)}</span>
            </div>`).join('')}
          ${(s.steps || []).length > 4 ? `<div class="hint">……共 ${s.steps.length} 步</div>` : ''}
        </div>
        <div class="row-between mt6">
          <button class="btn sm green" data-run="${s.id}">执行</button>
          <span class="row">
            <button class="icon-btn" data-export="${s.id}" title="导出 SKILL.md"><svg viewBox="0 0 24 24"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 18h14"/></svg></button>
            <button class="icon-btn" data-copy="${s.id}" title="复制给 AI"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5H6a1 1 0 0 0-1 1v9"/></svg></button>
            <button class="icon-btn" data-edit="${s.id}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
            <button class="icon-btn danger" data-del="${s.id}"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg></button>
          </span>
        </div>
      </div>`;
  }).join('')}</div>` : '<div class="card"><div class="empty">还没有 Skill。想想哪些工作是每周重复做的，把它写成步骤放进来</div></div>'}
  `;

  root.querySelector('#sknew').addEventListener('click', () => edit(null, () => mount(root)));
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => edit(b.dataset.edit, () => mount(root))));
  root.querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', () => {
    const s = store.load().skills.find(x => x.id === b.dataset.run);
    if (s) runModal(s, () => mount(root));       // 可能已被另一个标签页删掉
  }));
  root.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => {
    const s = store.load().skills.find(x => x.id === b.dataset.export);
    if (!s) { toast('这条 Skill 已不存在', 'warn'); return; }
    download(s.name.replace(/[\\/:*?"<>|]/g, '_') + '.SKILL.md', toSkillMd(s));
    toast('已导出', 'ok');
  }));
  root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const s = store.load().skills.find(x => x.id === b.dataset.copy);
    if (!s) { toast('这条 Skill 已不存在', 'warn'); return; }
    const ok = await copyText(PREFACE + toSkillMd(s) + '\n（参数还没填，我会把本次的具体参数一起发给你）');
    toast(ok ? '已复制，粘到对话里即可' : '复制失败', ok ? 'ok' : 'warn');
  }));
  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const n = b.closest('.skill-card').querySelector('.card-title').textContent;
    if (await confirmBox('删除 Skill', `删除「${n}」？`)) {
      store.update(d => { d.skills = d.skills.filter(x => x.id !== b.dataset.del); });
      toast('已删除'); mount(root);
    }
  }));
  root.querySelectorAll('[data-step]').forEach(c => c.addEventListener('click', e => {
    e.stopPropagation();
    const id = c.closest('.skill-card').dataset.sk;
    store.update(d => {
      const s = d.skills.find(x => x.id === id);
      const st = s && (s.steps || []).find(x => x.id === c.dataset.step);
      if (st) st.done = !st.done;
    });
    mount(root);
  }));
}

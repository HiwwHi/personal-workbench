import * as store from '../lib/store.js';
import * as fsa from '../lib/fsa.js';
import * as skillsView from './skills.js';
import * as ai from '../lib/aibridge.js';
import { esc, toast, modal, confirmBox, download, today } from '../lib/ui.js';

export const meta = { key: 'system', title: '系统设置', sub: '外观 · 数据源 · 备份 · 维护信息' };

export const THEMES = [
  { id: 'chenwu', group: '恬淡', name: '晨雾', desc: '灰蓝 + 鼠尾草绿', sw: ['#FAF9F7', '#4A6F8A', '#5F8F71', '#EBF1F5'] },
  { id: 'ouhe', group: '恬淡', name: '藕荷', desc: '藕粉紫 + 青绿', sw: ['#FAF8F9', '#8B7A8E', '#6F9480', '#F3EEF4'] },
  { id: 'taimi', group: '恬淡', name: '苔米', desc: '米黄 + 橄榄绿', sw: ['#FAF8F2', '#7E8A5A', '#6E8B52', '#EFF1E6'] },
  { id: 'wusong', group: '恬淡', name: '雾松', desc: '青灰 + 松绿', sw: ['#F7F9F9', '#5C7E7B', '#4F7F6A', '#EBF2F1'] },
  { id: 'xuanzhi', group: '恬淡', name: '宣纸', desc: '极简墨灰', sw: ['#FCFCFB', '#4A4A48', '#6B7F6B', '#F0F0EE'] },
  { id: 'qinglan', group: '清朗', name: '湖蓝', desc: '明确的蓝，提神', sw: ['#EDF4F9', '#2E6E9E', '#3D7F5E', '#E4EFF7'] },
  { id: 'songbai', group: '清朗', name: '松柏', desc: '浓绿，沉稳', sw: ['#EFF5ED', '#3E6B4C', '#4A7A4A', '#E6EFE8'] },
  { id: 'daizi', group: '清朗', name: '黛紫', desc: '紫调，柔和有辨识度', sw: ['#F4F1F9', '#6A5A93', '#5A8A6B', '#EDEAF6'] },
  { id: 'zheshi', group: '清朗', name: '赭石', desc: '暖棕，纸张感', sw: ['#F7F1E9', '#A5703C', '#6B8448', '#F6EDE1'] },
  { id: 'shanhu', group: '清朗', name: '珊瑚', desc: '砖红，温和不刺眼', sw: ['#F8F1EF', '#BE6058', '#5E8662', '#F9EBE9'] },
  { id: 'zhuyue', group: '清朗', name: '竹月', desc: '青绿，清透', sw: ['#EDF6F4', '#2F7A6E', '#438A5B', '#E3F0EC'] },
  { id: 'yehang', group: '夜间', name: '夜航', desc: '深蓝灰，晚上用', sw: ['#1B2025', '#6FA3C4', '#79B08A', '#25323C'], dark: true },
  { id: 'moye', group: '夜间', name: '墨夜', desc: '中性深灰，护眼', sw: ['#1E1E20', '#93A7BE', '#84AE8E', '#2A2F35'], dark: true }
];

export const THEME_GROUPS = ['恬淡', '清朗', '夜间'];

export const ACCENTS = [
  '#2E6E9E', '#4A6F8A', '#2F7A6E', '#3E6B4C', '#7E8A5A', '#A5703C',
  '#BE6058', '#B4655E', '#8B7A8E', '#6A5A93', '#5C7E7B', '#4A4A48'
];

function hex2rgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/** 把自定义主色应用到 --accent 系列（覆盖当前主题） */
export function applyAccent(hex, themeId) {
  const el = document.documentElement;
  const keys = ['--accent', '--accent-soft', '--accent-line', '--accent-hover', '--on-accent'];
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) { keys.forEach(k => el.style.removeProperty(k)); return; }
  const [h, s, l] = rgb2hsl(...hex2rgb(hex));
  const dark = (THEMES.find(t => t.id === themeId) || {}).dark;
  const soft = dark ? `hsl(${h} ${Math.min(s, 45)}% 20%)` : `hsl(${h} ${Math.min(s, 55)}% 94%)`;
  const line = dark ? `hsl(${h} ${Math.min(s, 50)}% 34%)` : `hsl(${h} ${Math.min(s, 60)}% 82%)`;
  const hover = `hsl(${h} ${s}% ${dark ? Math.min(90, l + 10) : Math.max(12, l - 9)}%)`;
  el.style.setProperty('--accent', hex);
  el.style.setProperty('--accent-soft', soft);
  el.style.setProperty('--accent-line', line);
  el.style.setProperty('--accent-hover', hover);
  el.style.setProperty('--on-accent', (dark ? l > 55 : l > 62) ? '#16202A' : '#FFFFFF');
}

export function applyTheme(id) {
  const tid = THEMES.some(t => t.id === id) ? id : 'chenwu';
  document.documentElement.dataset.theme = tid;
  return tid;
}

const slug = s => String(s).replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 60) || 'skill';

/* ------------------------------------------------------------------ 文档生成 */

function buildManual() {
  const d = store.load();
  return `# 个人工作台 · 维护说明书

> 本文件由工作台自动生成于 ${new Date().toLocaleString('zh-CN')}
> 作用：以后你想改这个工作台、或者让我帮你改，把这份文件发我，我能立刻进入状态。

## 一、它是什么

一个跑在本机的单页应用 + 一个只监听 127.0.0.1 的微型 node 服务。零依赖、零联网、无构建步骤。

## 二、目录结构

\`\`\`
personal-workbench/
├─ index.html                 单页外壳（左侧导航 + 顶栏 + #view）
├─ server.js                  零依赖静态服务，只监听 127.0.0.1:8733
├─ start-workbench.vbs        双击主入口：无黑框，起服务 + 托盘图标
├─ start-workbench.bat        兼容入口，转发到 vbs
├─ tray.ps1                   托盘常驻 + 拉服务 + 右键菜单（含开机自启开关）
├─ app.ico                    托盘图标（首次运行自动生成）
├─ assets/
│  ├─ css/main.css            全部样式，配色走 CSS 变量，主题在文件顶部 [data-theme=...]
│  └─ js/
│     ├─ app.js               路由 / 命令面板 / 备份弹窗 / 主题应用
│     ├─ lib/store.js         localStorage 数据层（键 wb.data.v1）
│     ├─ lib/fsa.js           File System Access 封装（工作/知识/运行时三个目录句柄）
│     ├─ lib/md.js            Markdown 渲染 + 按标题切片
│     ├─ lib/ui.js            toast / modal / 环形图 / 下载
│     ├─ lib/health.js        弱提醒引擎
│     ├─ lib/model.js         任务查询
│     └─ views/*.js           每个模块一个视图，导出 { meta, mount(root) }
└─ shots/                     八个模块的界面截图
\`\`\`

## 三、数据存在哪（重要）

| 数据 | 位置 | 会不会跟着文件夹走 |
|---|---|---|
| 密码 / 任务 / 学习 / Skill / 随手记 / 健康 | 浏览器 localStorage，键 \`wb.data.v1\` | **不会**，必须导出 JSON |
| 笔记正文 | 你自己选的文件夹里的 .md | 会（本来就在磁盘） |
| 备份 / 回收站 / 导出 / Cursor 包 | 你选的「中间文件目录」 | 会（如果在同一棵目录树里） |

localStorage **按 origin 隔离**：\`http://127.0.0.1:8733\` 和别的端口 = 两个不同的库。换端口等于换库。

## 四、启动与停止

- 启动：双击 \`start-workbench.vbs\`（无黑框，托盘出图标）
- 开机自启：托盘右键 → 勾选「开机自动启动」（往 Windows 启动文件夹写 Workbench-Autostart.vbs）
- 停止：托盘右键 → 「停止服务并退出」
- 依赖：Node.js。tray.ps1 依次找项目 \`runtime\\node.exe\`、WorkBuddy 自带 node、系统安装的 node、PATH

## 五、快捷键

| 键 | 作用 |
|---|---|
| Ctrl + K | 全局搜索（任务/密码/笔记/Skill/随手记） |
| Ctrl + B / I / H | 笔记编辑：加粗 / 斜体 / 标题 |
| Ctrl + E / Ctrl + L | 行内代码 / 链接 |
| Ctrl + S | 笔记保存到磁盘（只有这个动作会写盘） |
| Tab / Shift+Tab | 笔记缩进 / 反缩进 |

## 六、安全机制（不要破坏这些）

1. 笔记默认**阅读模式**，编辑需手动切
2. 切页面、关浏览器都**不自动保存**
3. 每次保存前把原文件备份到「中间文件目录/备份/」
4. 保存前比对 mtime，被外部改过会拦下来问
5. 删除只进「中间文件目录/回收站/」，不真删
6. AI 回填必须先看预览 + 二次确认

## 七、改代码时容易踩的坑

1. \`[hidden]\` 需要 \`display:none !important\`，否则被 \`.palette{display:flex}\` 覆盖，遮罩层会挡住全站点不了
2. 全局 \`svg{width:18px}\` 会压掉内联尺寸，需要真实尺寸的 SVG 用 inline style
3. **弹窗保存后刷新必须用 \`modal({ done })\` 回调**，不能 \`setTimeout(mount)\` —— 那会在用户填表前就执行
4. 视图内事件委托要用模块级 \`bound\` 守卫，否则每次重渲染都叠加监听
5. \`tray.ps1\` 是 UTF-8 **带 BOM**，改完别把 BOM 弄丢，否则 PowerShell 5.1 会把中文读成乱码
6. Windows PowerShell 里 \`New-Object ContextMenu(@(a,b))\` 会报"找不到重载"，要用 \`MenuItems.AddRange([MenuItem[]]@(...))\`
7. **加新主题要改两处**：\`css/main.css\` 里加 \`[data-theme="id"]\` 变量块，\`views/system.js\` 的 \`THEMES\` 数组里加同名条目。只改一处的话 \`applyTheme\` 会判定 id 非法并回退到晨雾。夜间主题还要带上 \`--on-accent/--on-green\`（深底上的浅色按钮要用深字）
8. 主题里**不允许出现硬编码颜色**。按钮文字用 \`var(--on-accent)\`，环形图用 \`var(--surface-3)/var(--green)\`，否则切到夜间主题会出现白底白字

## 八、当前数据规模

- 账号密码 ${d.vault.length} 条
- 项目 ${d.projects.length} 个
- 学习计划 ${d.study.length} 个
- Skill ${d.skills.length} 个
- 随手记 ${d.jots.length} 条
- 健康规则 ${(d.health.rules || []).length} 条
`;
}

function buildMigration() {
  return `# 把工作台搬到另一台电脑

生成时间：${new Date().toLocaleString('zh-CN')}

## 结论先说

**直接复制文件夹能打开，但数据会是空的。** 因为任务、密码、Skill 这些存在浏览器 localStorage 里，不在文件夹里。必须多一步导出 / 导入。

## 三步走

### 第 1 步：在这台机器上导出数据

侧栏「备份与导出」或本页「数据与备份」→ 导出全量 JSON。
⚠️ 这个文件里**密码是明文**，别丢网盘、别发聊天。

### 第 2 步：搬文件

把整个项目文件夹复制过去（U 盘 / 同步盘都行）。
如果笔记正文也想一起搬，笔记文件夹和「中间文件目录」也要一起复制。

### 第 3 步：在新机器上

1. 装 Node.js（https://nodejs.org ，一路下一步）
2. 双击 \`start-workbench.vbs\`
3. 打开后进入「系统设置」→「数据与备份」→ 把第 1 步的 JSON 粘进去恢复
4. 「笔记源」里重新连接两个笔记文件夹（浏览器会重新问一次权限，正常）
5. 重新选一次「中间文件目录」

## 有没有绑定绝对路径？

| 位置 | 是否写死 | 说明 |
|---|---|---|
| \`start-workbench.vbs\` | 否 | 用 \`WScript.ScriptFullName\` 自己算目录 |
| \`tray.ps1\` | 否 | 依次找项目 runtime、WorkBuddy 自带 node、系统安装的 node、PATH |
| \`Workbench-Autostart.vbs\` | 是 | 开机自启脚本，换机器要重新在托盘菜单里勾一次 |
| 笔记文件夹 / 中间文件目录 | 否 | 存在浏览器 IndexedDB 里的目录句柄，换机器会失效，重新选一次即可 |
| 服务端口 | 固定 8733 | **建议不要改**，改成别的端口 = 换了个空数据库 |

## 换机器后可能遇到

- **打开是空白 / 控制台报模块错误**：必须用 \`start-workbench.vbs\` 或本地服务打开，不能直接双击 index.html（file:// 下浏览器会禁用 ES module 和文件夹直连）
- **提示"浏览器不支持文件夹直连"**：换 Chrome 或 Edge
- **托盘图标没出现**：PowerShell 执行策略限制，用管理员 PowerShell 跑一次 \`Set-ExecutionPolicy RemoteSigned\` 
`;
}

function buildCursorRules() {
  return `---
description: 个人工作台协作约定
alwaysApply: true
---

# 个人工作台协作约定

这台机器上有一个本地工作台（http://127.0.0.1:8733），里面存着我的工作 Skill 和笔记。

## 笔记在哪

- 工作流程笔记：工作台「系统设置 → 笔记源」里显示的工作流程目录
- 知识笔记：工作台「系统设置 → 笔记源」里显示的知识目录
- 两边都是普通 Markdown，你可以直接读写，磁盘上的 md 是唯一真源

## 铁律（违反会出事）

1. **改任何笔记前先给我看内容，我确认后才写盘。** 不要自作主张改写我的文件。
2. 写文件前先备份，不要把原内容冲掉。
3. 笔记里的章节可以按 \`#\` 标题切片；\`\`\` 代码块里的 \`#\` 不是标题，别误切。

## Skill 怎么用

\`.cursor/skills/\` 下每个目录一个 Skill，SKILL.md 里有触发场景、输入参数、执行步骤、输出模板。
我提需求时如果匹配到某个 Skill，就严格按「执行步骤」推进，结果按「输出模板」输出。

## AI 协作流程

我给资料 → 你按现有格式整理 → **先回答给我看** → 我确认 → 才落盘。
`;
}

/* ------------------------------------------------------------------ 视图 */

export async function mount(root) {
  const st = store.settings();
  const d = store.load();
  const rtName = await fsa.runtimeName();
  const workName = (await fsa.currentDir('work'))?.name || null;
  const knowName = (await fsa.currentDir('know'))?.name || null;

  const srcCard = (slot, label, desc, name) => `
    <div class="src-card">
      <div class="row-between">
        <b>${label}</b>
        <span class="tag ${name ? 'green' : ''}">${name ? '已连接' : '未连接'}</span>
      </div>
      <div class="hint">${desc}</div>
      ${name ? `<div class="sp">${esc(name)}</div>` : ''}
      <div class="row mt6 wrap">
        <button class="btn sm" data-srcdir="${slot}">${name ? '更换文件夹' : '连接文件夹'}</button>
        <button class="btn sm" data-srcmem="${slot}">用内置库</button>
        ${name ? `<button class="btn sm danger" data-srcclr="${slot}">断开</button>` : ''}
      </div>
    </div>`;

  root.innerHTML = `
    <div class="grid grid-2">

      <div class="card span2">
        <div class="card-head">
          <div class="card-title">外观主题</div>
          <span class="hint">${THEMES.length} 套 · 恬淡系偏浅、清朗系更明确、夜间系深底</span>
        </div>
        ${THEME_GROUPS.map(g => `
          <div class="theme-sec">
            <div class="theme-sec-t">${g}系<span class="hint">${
              g === '恬淡' ? '最淡，几乎无彩度，久看不累' :
              g === '清朗' ? '颜色更明确，辨识度高但仍柔和' : '深底，晚上或光线暗时用'
            }</span></div>
            <div class="theme-grid">
              ${THEMES.filter(t => t.group === g).map(t => `
                <div class="theme-card ${st.theme === t.id ? 'on' : ''}" data-theme="${t.id}">
                  <div class="theme-sw">${t.sw.map(c => `<i style="background:${c}"></i>`).join('')}</div>
                  <div class="theme-name">${t.name}${t.dark ? ' <span class="tag">夜间</span>' : ''}</div>
                  <div class="theme-desc">${t.desc}</div>
                </div>`).join('')}
            </div>
          </div>`).join('')}

        <div class="theme-sec">
          <div class="theme-sec-t">自定义主色<span class="hint">只改强调色（按钮、选中、链接），底色文字不变</span></div>
          <div class="row wrap">
            ${ACCENTS.map(c => `<i class="sw-dot ${(st.accent || '').toLowerCase() === c.toLowerCase() ? 'on' : ''}" data-accent="${c}" style="background:${c}"></i>`).join('')}
            <input type="color" id="accentPick" value="${/^#[0-9a-fA-F]{6}$/.test(st.accent || '') ? st.accent : '#4A6F8A'}" title="自定义颜色">
            <button class="btn sm" id="btnAccentClear">恢复主题原色</button>
          </div>
          <div class="hint mt6">选一个圆点或点色块自己调。设置会记住，换主题后依然生效。</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">首页显示什么</div></div>
        <label class="switch mb8"><input type="checkbox" id="swHealth" ${st.homeHealth ? 'checked' : ''}>
          首页显示健康提醒（喝水 / 起身 / 护眼）</label>
        <div class="hint mb12">默认关闭——健康数据放首页容易被同事看到。数据照常记录，去「健康管理」页看。</div>
        <label class="switch mb8"><input type="checkbox" id="swNotes" ${st.homeNotes ? 'checked' : ''}>
          首页显示最近常看的笔记</label>
        <div class="hint mb12">关闭后首页只剩待办和排期，最干净。</div>
        <label class="switch"><input type="checkbox" id="swPrivacy" ${st.privacy ? 'checked' : ''}>
          隐私模式（隐藏密码 / 健康 / 随手记入口）</label>
        <div class="hint mt6">打开后左侧导航里的敏感模块会整块隐藏，健康提醒也会停。</div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">笔记源（两个，各管各的）</div></div>
        <div class="grid grid-2">
          ${srcCard('work', '工作流程笔记', '排障流程、操作手册、对接记录这类"怎么干"的', workName)}
          ${srcCard('know', '知识笔记', '原理、概念、技术要点这类"为什么"的', knowName)}
        </div>
        <div class="hint mt12">两块可以是完全不同的位置（比如一个在工作盘、一个在同步盘）。磁盘上的 md 是唯一真源，用 VSCode / Obsidian 改也行。</div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">中间文件目录</div>
          <span class="tag ${rtName ? 'green' : 'amber'}">${rtName ? '已设置' : '未设置'}</span>
        </div>
        <div class="hint mb8">所有中间产物都放这里，<b>笔记源目录保持完全干净</b>：</div>
        <div class="kv"><span class="k">备份/</span><span class="v">每次保存前的原文件快照</span></div>
        <div class="kv"><span class="k">回收站/</span><span class="v">删掉的笔记（不真删）</span></div>
        <div class="kv"><span class="k">导出/</span><span class="v">单章导出的 md</span></div>
        <div class="kv"><span class="k">交接给AI/</span><span class="v">导出给 AI 的笔记包</span></div>
        <div class="kv"><span class="k">cursor/</span><span class="v">导出的 .cursor 目录包</span></div>
        <div class="kv"><span class="k">文档/</span><span class="v">说明书、迁移指南</span></div>
        ${rtName ? `<div class="sp mt6" style="font-size:12px;color:var(--text-3)">当前：${esc(rtName)}</div>` : ''}
        <div class="row mt12">
          <button class="btn primary sm" id="btnPickRuntime">${rtName ? '更换目录' : '选择目录'}</button>
          <span class="hint">建议建在工作台项目的<b>上一层</b>，比如「工作台文件」</span>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Cursor 联动</div><span class="hint">把 Skill 变成 Cursor 认得的格式</span></div>
        <div class="hint mb12">
          生成 \`.cursor/skills/&lt;名字&gt;/SKILL.md\` + \`.cursor/rules/workbench.mdc\`。
          把整个 \`.cursor\` 目录拷到 Cursor 项目的根目录，Cursor 就会自动加载这些 Skill。
        </div>
        <div class="row wrap">
          <button class="btn primary sm" id="btnCursor">导出 .cursor 包</button>
          <button class="btn sm" id="btnCursorRules">复制规则文本</button>
        </div>
        <div class="hint mt12">当前有 ${d.skills.length} 个 Skill 会被导出。导出位置在「中间文件目录/cursor/」。</div>
      </div>

      <div class="card span2">
        <div class="card-head">
          <div class="card-title">AI 联动</div>
          <span class="hint">直接用本机的 Cursor / VSCode 打开本工作台的目录与文件</span>
        </div>
        <div class="hint mb12">
          工作台里的笔记源 / 中间文件目录 <b>必须先在「笔记源 / 中间文件目录」里连接</b>，否则浏览器没权限让本地服务代你打开。
          服务端只允许打开你已登记的根目录下的路径——其他盘符、系统的敏感目录会被拒绝。
        </div>

        <div class="mb12">
          <div class="card-title mb8">目录绝对路径（浏览器拿不到，需要手动填写）</div>
          <div class="grid grid-3">
            <label class="field"><span>工作笔记目录</span>
              <input type="text" data-dirpath="work" placeholder="例：D:\notes\work" value="${esc(((st.dirPaths || {}).work) || '')}"></label>
            <label class="field"><span>知识笔记目录</span>
              <input type="text" data-dirpath="know" placeholder="例：D:\notes\know" value="${esc(((st.dirPaths || {}).know) || '')}"></label>
            <label class="field"><span>中间文件目录</span>
              <input type="text" data-dirpath="runtime" placeholder="例：D:\workbench-data" value="${esc(((st.dirPaths || {}).runtime) || '')}"></label>
          </div>
          <div class="hint mt6">
            浏览器的 File System Access API 出于安全只给文件夹名字、不给真实路径，
            所以「用 Cursor 打开 / 在资源管理器显示 / 生成快照」这些功能需要你在这里补一次绝对路径。
            只保存在本机浏览器，不会上传。
          </div>
        </div>

        <div class="grid grid-2">
          <div>
            <div class="card-title mb8">一键唤起编辑器</div>
            <div class="hint mb6">${workName ? '工作笔记 · ' + esc(workName) : '工作笔记 · 未连接'}</div>
            <div class="row mb12">
              <button class="btn primary sm" id="btnOpenWorkC" ${workName ? '' : 'disabled'}>用 Cursor 打开</button>
              <button class="btn sm" id="btnOpenWorkV" ${workName ? '' : 'disabled'}>用 VSCode 打开</button>
            </div>
            <div class="hint mb6">${knowName ? '知识笔记 · ' + esc(knowName) : '知识笔记 · 未连接'}</div>
            <div class="row mb12">
              <button class="btn primary sm" id="btnOpenKnowC" ${knowName ? '' : 'disabled'}>用 Cursor 打开</button>
              <button class="btn sm" id="btnOpenKnowV" ${knowName ? '' : 'disabled'}>用 VSCode 打开</button>
            </div>
            <div class="hint mb6">${rtName ? '中间文件 · ' + esc(rtName) : '中间文件 · 未设置'}</div>
            <div class="row">
              <button class="btn primary sm" id="btnOpenRtC" ${rtName ? '' : 'disabled'}>用 Cursor 打开</button>
              <button class="btn sm" id="btnOpenRtV" ${rtName ? '' : 'disabled'}>用 VSCode 打开</button>
              ${rtName ? `<button class="btn sm" id="btnRevealRt">在资源管理器中显示</button>` : ''}
            </div>
          </div>

          <div>
            <div class="card-title mb8">给 AI 看的现状快照</div>
            <div class="hint mb8">
              生成一份包含「今日待办 / 逾期 / 项目进度 / Skill / 随手记」的 markdown，
              自动存到「中间文件目录/给AI看/」，然后用 Cursor 打开。
              你只要在 Cursor 的 Composer 里 @ 这份文件提问，就能基于你工作台的真实数据回答。
            </div>
            <div class="row wrap">
              <button class="btn primary sm" id="btnSnapshot">生成快照并用 Cursor 打开</button>
              <button class="btn sm" id="btnSnapshotDl">只生成快照（下载）</button>
              <button class="btn sm" id="btnSnapshotPath">在资源管理器显示</button>
            </div>
            <div class="hint mt6">没装 Cursor 时会改用 VSCode。零成本、无 API Key、不出本机。</div>
          </div>
        </div>

        <hr>

        <div class="row-between wrap">
          <div>
            <div class="card-title">把 Skill 装到本机 Cursor</div>
            <div class="hint mt6">
              把 ${d.skills.length} 个 Skill 直接写入 <code>~/.cursor/skills/&lt;名字&gt;/SKILL.md</code>，
              装好后<strong>所有 Cursor 项目都认</strong>（无需复制 .cursor 目录）。装完会打开你的 Cursor 用户配置目录让你确认。
            </div>
          </div>
          <div class="row">
            <button class="btn primary sm" id="btnInstallSkills">装到本机 Cursor</button>
            <button class="btn sm" id="btnOpenUserCfg">打开 Cursor 配置目录</button>
          </div>
        </div>

        <div class="hint mt12" style="color:var(--text-3)">
          原理：本机服务（<code>server.js</code>）提供 <code>/api/open</code> / <code>/api/roots</code> / <code>/api/shell</code> 三个端点。
          浏览器 fetch 同源调用，服务端校验路径必须在已登记的根目录下才允许 spawn Cursor / VSCode。
          服务只监听 <code>127.0.0.1:8733</code>，完全不出本机。
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">数据与备份</div></div>
        <div class="grid grid-4 mb12">
          <div class="stat"><div class="stat-num">${d.vault.length}</div><div class="stat-label">密码</div></div>
          <div class="stat"><div class="stat-num">${d.projects.length}</div><div class="stat-label">项目</div></div>
          <div class="stat"><div class="stat-num">${d.skills.length}</div><div class="stat-label">Skill</div></div>
          <div class="stat"><div class="stat-num">${d.jots.length}</div><div class="stat-label">随手记</div></div>
        </div>
        <div class="row wrap">
          <button class="btn primary sm" id="btnExport">导出全量 JSON</button>
          <button class="btn sm" id="btnImport">从 JSON 恢复</button>
        </div>
        <div class="hint mt12">JSON 里密码是<b>明文</b>的，别丢网盘或发聊天。笔记正文不在里面（它们在你的文件夹里）。</div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">系统信息</div><span class="hint">让我帮你改的时候，发这份就够</span></div>
        <div class="kv"><span class="k">运行方式</span><span class="v">本地服务 http://127.0.0.1:8733（只监听本机）</span></div>
        <div class="kv"><span class="k">技术栈</span><span class="v">原生 ES module + CSS 变量，无框架、无构建</span></div>
        <div class="kv"><span class="k">数据存储</span><span class="v">localStorage['wb.data.v1']（按 origin 隔离）</span></div>
        <div class="kv"><span class="k">目录句柄</span><span class="v">IndexedDB 'wb-notes-fs'</span></div>
        <div class="kv"><span class="k">笔记源</span><span class="v">工作：${esc(workName || '未连接')} ｜ 知识：${esc(knowName || '未连接')}</span></div>
        <div class="kv"><span class="k">中间文件</span><span class="v">${esc(rtName || '未设置')}</span></div>
        <div class="kv"><span class="k">当前主题</span><span class="v">${(THEMES.find(t => t.id === st.theme) || THEMES[0]).name}</span></div>
        <div class="kv"><span class="k">浏览器</span><span class="v">${navigator.userAgent.slice(0, 90)}</span></div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">维护与迁移</div></div>
        <div class="hint mb12">这两份文档会把整个项目的结构、坑、迁移步骤写清楚。生成到「中间文件目录/文档/」，也可以直接下载。</div>
        <div class="row wrap">
          <button class="btn sm" id="btnManual">生成《工作台说明书.md》</button>
          <button class="btn sm" id="btnMigrate">生成《迁移到另一台电脑.md》</button>
        </div>
        <div class="hint mt12">
          换电脑的要点：<b>复制文件夹能打开，但数据要单独导出 JSON 再导入</b>（数据存在浏览器里，不在文件夹里）。
          端口保持 8733，改了等于换库。
        </div>
      </div>

    </div>
  `;

  wire(root);
}

function wire(root) {
  root.querySelectorAll('[data-theme]').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.theme;
    store.setSetting('theme', id);
    applyTheme(id);
    applyAccent(store.load().settings.accent, id);
    mount(root);
    toast('已切换主题', 'ok');
  }));

  root.querySelectorAll('[data-accent]').forEach(el => el.addEventListener('click', () => {
    const c = el.dataset.accent;
    store.setSetting('accent', c);
    applyAccent(c, store.load().settings.theme);
    mount(root);
    toast('主色已更新', 'ok');
  }));

  const pick = root.querySelector('#accentPick');
  if (pick) pick.addEventListener('change', () => {
    store.setSetting('accent', pick.value);
    applyAccent(pick.value, store.load().settings.theme);
    mount(root);
    toast('主色已更新', 'ok');
  });

  const clr = root.querySelector('#btnAccentClear');
  if (clr) clr.addEventListener('click', () => {
    store.setSetting('accent', '');
    applyAccent('', store.load().settings.theme);
    mount(root);
    toast('已恢复主题原色', 'ok');
  });

  const on = (id, fn) => { const el = root.querySelector(id); if (el) el.addEventListener("click", fn); };

  /* 目录绝对路径：浏览器拿不到真实路径，用户手填后保存 */
  root.querySelectorAll('[data-dirpath]').forEach(el => el.addEventListener('change', () => {
    const slot = el.dataset.dirpath;
    const v = el.value.trim();
    store.update(d2 => {
      d2.settings.dirPaths = d2.settings.dirPaths || {};
      d2.settings.dirPaths[slot] = v;
    });
    toast('路径已保存', 'ok');
  }));

  const bind = (id, key) => {
    const el = root.querySelector(id);
    if (el) el.addEventListener('change', () => {
      store.setSetting(key, el.checked);
      if (key === 'privacy') document.body.classList.toggle('privacy-on', el.checked);
      toast('已保存', 'ok');
    });
  };
  bind('#swHealth', 'homeHealth');
  bind('#swNotes', 'homeNotes');
  bind('#swPrivacy', 'privacy');

  root.querySelectorAll('[data-srcdir]').forEach(el => el.addEventListener('click', async () => {
    try {
      const slot = el.dataset.srcdir;
      await fsa.pickDir(slot);
      store.update(() => { store.notesSlotUI(slot).source = 'fsa'; });
      toast('已连接', 'ok'); mount(root);
    } catch (e) { toast('未选择文件夹', 'warn'); }
  }));

  root.querySelectorAll('[data-srcmem]').forEach(el => el.addEventListener('click', () => {
    const slot = el.dataset.srcmem;
    store.update(d2 => { d2.notesDocs = d2.notesDocs || []; store.notesSlotUI(slot).source = 'mem'; });
    toast('已改用内置库', 'ok'); mount(root);
  }));

  root.querySelectorAll('[data-srcclr]').forEach(el => el.addEventListener('click', async () => {
    const slot = el.dataset.srcclr;
    if (!(await confirmBox('断开笔记文件夹', '只是解除连接，磁盘上的文件不会动。确定吗？'))) return;
    await fsa.clearDir(slot);
    store.update(() => { store.notesSlotUI(slot).source = ''; });
    toast('已断开'); mount(root);
  }));

  const rt = root.querySelector('#btnPickRuntime');
  if (rt) rt.addEventListener('click', async () => {
    try {
      await fsa.pickDir('runtime');
      toast('中间文件目录已设置', 'ok'); mount(root);
    } catch (e) { toast('未选择文件夹', 'warn'); }
  });

  const bc = root.querySelector('#btnCursor');
  if (bc) bc.addEventListener('click', () => exportCursor());
  const bcr = root.querySelector('#btnCursorRules');
  if (bcr) bcr.addEventListener('click', async () => {
    const { copyText } = await import('../lib/ui.js');
    await copyText(buildCursorRules());
    toast('规则文本已复制', 'ok');
  });

  /* ---- AI 联动 ---- */
  const openDir = (app, slot) => async () => {
    try {
      let dir;
      if (slot === 'work') dir = await fsa.currentDir('work');
      else if (slot === 'know') dir = await fsa.currentDir('know');
      else if (slot === 'runtime') dir = await fsa.runtimePath();
      if (!dir) { toast('该目录未连接', 'warn'); return; }
      if (!dir.root) { toast('请先在上方填写该目录的绝对路径', 'warn'); return; }
      await ai.registerRoots();
      await ai.openInEditor({ app, target: dir.root });
      toast('已交给 ' + app + ' 打开', 'ok');
    } catch (e) { toast(e.message || '打开失败', 'warn'); }
  };
  on('#btnOpenWorkC', openDir('cursor', 'work'));
  on('#btnOpenWorkV', openDir('vscode', 'work'));
  on('#btnOpenKnowC', openDir('cursor', 'know'));
  on('#btnOpenKnowV', openDir('vscode', 'know'));
  on('#btnOpenRtC',   openDir('cursor', 'runtime'));
  on('#btnOpenRtV',   openDir('vscode', 'runtime'));

  const rev = root.querySelector('#btnRevealRt');
  if (rev) rev.addEventListener('click', async () => {
    try {
      const dir = await fsa.runtimePath();
      if (!dir) return;
      if (!dir.root) { toast('请先填写中间文件目录的绝对路径', 'warn'); return; }
      await ai.registerRoots();
      await ai.revealInExplorer(dir.root);
      toast('已在资源管理器打开', 'ok');
    } catch (e) { toast(e.message, 'warn'); }
  });

  const snap = root.querySelector('#btnSnapshot');
  if (snap) snap.addEventListener('click', async () => {
    try {
      await ai.registerRoots();
      await ai.saveSnapshot();
      const dir = await fsa.runtimePath();
      if (!dir) throw new Error('未设置中间文件目录');
      if (!dir.root) throw new Error('请先填写中间文件目录的绝对路径');
      await ai.openInEditor({ app: 'cursor', target: dir.root + '\\给AI看' });
      toast('快照已生成并交给 Cursor', 'ok');
    } catch (e) { toast(e.message, 'warn'); }
  });
  const snapDl = root.querySelector('#btnSnapshotDl');
  if (snapDl) snapDl.addEventListener('click', async () => {
    try {
      const md = ai.buildSnapshot();
      download('工作台现状-' + today() + '.md', md);
      toast('已下载', 'ok');
    } catch (e) { toast(e.message, 'warn'); }
  });
  const snapPath = root.querySelector('#btnSnapshotPath');
  if (snapPath) snapPath.addEventListener('click', async () => {
    try {
      await ai.saveSnapshot();
      const dir = await fsa.runtimePath();
      if (!dir) return;
      if (!dir.root) { toast('请先填写中间文件目录的绝对路径', 'warn'); return; }
      await ai.registerRoots();
      try {
        await ai.revealInExplorer(dir.root + '\\给AI看');
        toast('已在资源管理器打开', 'ok');
      } catch (e) {
        toast(/不存在/.test(e.message) ? '还没生成过快照，先点「生成并交给 Cursor」' : e.message, 'warn');
      }
    } catch (e) { toast(e.message, 'warn'); }
  });

  const inst = root.querySelector('#btnInstallSkills');
  if (inst) inst.addEventListener('click', async () => {
    try {
      const skills = d.skills.map(s => ({ name: s.name, content: skillsView.toSkillMd(s) }));
      let r;
      try {
        r = await ai.installCursorUserSkills(skills);
      } catch (e) {
        const need = e.data && e.data.needsRoot;
        if (!need) throw e;
        const ok = await confirmBox('需要登记信任目录',
          `要写入 ${need}，它还没在信任目录里。登记后本机服务才允许往这个目录写文件，是否允许？`,
          '允许并安装', false);
        if (!ok) return;
        await ai.addRoot(need, { mkdir: true });
        r = await ai.installCursorUserSkills(skills);
      }
      toast('已安装 ' + r.installed + ' 个 Skill 到 ' + r.dest, 'ok');
      await ai.revealCursorUserConfig();
    } catch (e) { toast(e.message, 'warn'); }
  });
  const uc = root.querySelector('#btnOpenUserCfg');
  if (uc) uc.addEventListener('click', () => ai.revealCursorUserConfig().catch(e => toast(e.message, 'warn')));

  const be = root.querySelector('#btnExport');
  if (be) be.addEventListener('click', () => {
    download(`工作台备份-${today()}.json`, store.exportAll(), 'application/json;charset=utf-8');
    toast('已导出备份文件', 'ok');
  });

  const bi = root.querySelector('#btnImport');
  if (bi) bi.addEventListener('click', () => {
    modal({
      title: '从 JSON 恢复', okText: '恢复',
      body: `<div class="hint mb12">把以前导出的 JSON 整段粘进来，会<b>覆盖</b>当前数据。</div>
        <textarea rows="6" id="impJson2" placeholder='{"__app":"personal-workbench", ...}'></textarea>`,
      onOk(body) {
        const t = body.querySelector('#impJson2').value.trim();
        if (!t) { toast('没有内容', 'warn'); return false; }
        try { store.importAll(t); toast('数据已恢复', 'ok'); mount(root); return true; }
        catch (e) { toast('JSON 解析失败：' + e.message, 'warn'); return false; }
      }
    });
  });

  const bm = root.querySelector('#btnManual');
  if (bm) bm.addEventListener('click', () => saveDoc('工作台说明书.md', buildManual()));
  const bg = root.querySelector('#btnMigrate');
  if (bg) bg.addEventListener('click', () => saveDoc('迁移到另一台电脑.md', buildMigration()));
}

async function saveDoc(name, content) {
  if (await fsa.runtimeReady()) {
    try {
      const rel = await fsa.writeRuntime('文档', name, content);
      toast(`已写入 中间文件目录/${rel}`, 'ok');
      return;
    } catch (e) { /* 落到下载 */ }
  }
  download(name, content, 'text/markdown;charset=utf-8');
  toast('还没设置中间文件目录，已改为下载', 'warn');
}

async function exportCursor() {
  const skills = store.load().skills || [];
  if (!skills.length) { toast('还没有 Skill 可导出', 'warn'); return; }
  if (!(await fsa.runtimeReady())) {
    if (!(await confirmBox('还没设置中间文件目录', '导出的 .cursor 包需要一个落脚点。现在去选一个目录？', '去选择'))) return;
    try { await fsa.pickDir('runtime'); } catch (e) { return; }
  }
  try {
    for (const s of skills) {
      await fsa.writeRuntime(`cursor/.cursor/skills/${slug(s.name)}`, 'SKILL.md', skillsView.toSkillMd(s));
    }
    await fsa.writeRuntime('cursor/.cursor/rules', 'workbench.mdc', buildCursorRules());
    await fsa.writeRuntime('cursor', 'README.md',
      `# 怎么用这个包\n\n把 \`.cursor\` 整个目录拷到你的 Cursor 项目根目录：\n\n\`\`\`\n你的项目/\n├─ .cursor/\n│  ├─ rules/workbench.mdc\n│  └─ skills/*/SKILL.md\n└─ ...\n\`\`\`\n\nCursor 会自动加载 skills 下的 Skill。\n如果项目里已有 .cursor 目录，只把 skills 和 rules 里的内容合并进去即可，不要覆盖别人的文件。\n`);
    toast(`已导出 ${skills.length} 个 Skill 到 中间文件目录/cursor/`, 'ok');
  } catch (e) {
    toast('导出失败：' + e.message, 'warn');
  }
}

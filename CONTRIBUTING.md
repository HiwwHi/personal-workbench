# 参与贡献

这是个很小的本地工具，代码量不大、没有构建步骤，改动门槛很低。提 PR 之前请先看下面几节。

## 先跑起来

```bash
npm install
npm start        # 桌面版（Electron，带托盘）
npm run server   # 只起本地服务，然后浏览器打开 http://127.0.0.1:8733
npm run selfcheck  # 自检：起服务跑一遍关键检查，改完先跑这个
```

Windows 上也可以双击 `start-workbench.vbs`（需要本机有 node）。

## 代码结构

| 路径 | 负责什么 |
|---|---|
| `server.js` | 零依赖本地服务：静态文件 + `/api/open`、`/api/roots`、`/api/shell`、`/api/ping` |
| `electron/main.js` | 主进程：起服务、开窗口、托盘、原生选目录 |
| `electron/preload.js` | 唯一暴露给页面的桌面能力（`workbenchDesktop.pickDir`） |
| `assets/js/lib/` | store / fsa / md / ui / health / model / aibridge |
| `assets/js/views/` | 9 个页面模块，一个模块一个文件 |
| `assets/css/main.css` | 全部样式，配色走 CSS 变量 |

没有打包步骤：改完 JS 刷新页面就生效，改 CSS 同理。桌面版的改动需要重启 `npm start`。

## 改代码时的几个硬规矩

1. **不引入框架和构建工具**（React / Vue / TypeScript / webpack / vite 都不要）。这个是刻意保持的，加了就没法"改完刷新即生效"。
2. **不加联网功能**。任何把数据发出去的行为（统计、更新检查、云同步）都不接受。
3. **`server.js` 新增文件操作必须先过 `inRoots()` 校验**，别给外部网页开口子。
4. **页面里的用户数据一律走 `esc()`** 再拼进 HTML；Markdown 渲染出来的 HTML 是唯一例外，改动 `lib/md.js` 时要保证它自己安全。
5. **新增主题要改两处**：`assets/css/main.css` 的变量块 + `views/system.js` 的 `THEMES` 数组。
6. **`tray.ps1` 必须保持 UTF-8 带 BOM**，否则 PowerShell 5.1 会把中文读成乱码。
7. 桌面版专属能力走 `electron/preload.js`，别把 Node 塞进页面（`contextIsolation` 和 `nodeIntegration: false` 要一直保持）。

## 提交与 PR

- 一次提交只做一件事，提交信息写清楚做了什么（`fix: 修正笔记备份路径` 比 `update` 有用得多）
- 大一点的改动请先开 issue 说明想法，避免写完发现方向不对
- PR 里写清楚：改了什么、怎么验证的（截图或 `npm run selfcheck` 的输出都可以）
- 如果改动影响界面，请附一张脱敏后的截图（**不要用真实项目名、客户名、本机用户名路径**）

## 安全问题

发现敏感问题（比如能让外部程序调用本地接口、路径越权）**不要开公开 issue**，用仓库的 Security → Report a vulnerability 私下报，或者直接发邮件给仓库作者。

## 关于数据

工作台的数据都在用户自己的机器上（`localStorage` + 用户选的文件夹）。调试时请用空库或自造的示例数据，**不要把别人的真实笔记、密码、健康记录提交进仓库**。

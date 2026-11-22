const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('../server.js');

const DEFAULT_PORT = 8733;
const PORT_TRIES = 10;                 // 依次尝试 8733 ~ 8742
const ROOT = path.join(__dirname, '..');

let win = null;
let tray = null;
let server = null;
let activePort = DEFAULT_PORT;         // 实际使用的端口（可能与默认不同）

// 单实例：第二次双击时唤醒已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(boot);
}

/** 判断端口上跑的是不是本工作台 */
async function isOurServer(port) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 800);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: ctrl.signal });
    const j = await r.json();
    return !!(r.ok && j && j.app === 'personal-workbench');
  } catch { return false; }
  finally { clearTimeout(timer); }
}

/** 原生选目录：给页面补上浏览器拿不到的绝对路径 */
ipcMain.handle('wb:pick-dir', async (e, defaultPath) => {
  if (!win || win.isDestroyed() || e.sender !== win.webContents) return null;
  const r = await dialog.showOpenDialog(win, {
    title: '选择这个文件夹的位置',
    buttonLabel: '就是这个',
    defaultPath: defaultPath || undefined,
    properties: ['openDirectory', 'dontAddToRecent']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

async function boot() {
  // 默认端口上已是本工作台（如托盘版先起了）→ 复用
  if (await isOurServer(DEFAULT_PORT)) {
    activePort = DEFAULT_PORT;
    return openUI();
  }
  // 否则依次找可用端口，被别的程序占用就换下一个
  const lastPort = DEFAULT_PORT + PORT_TRIES - 1;
  for (let p = DEFAULT_PORT; p <= lastPort; p++) {
    try {
      // 白名单等可写状态放到用户数据目录，避免打包进 asar 后不可写
      server = await startServer({ port: p, dataDir: app.getPath('userData') });
      activePort = p;
      return openUI();
    } catch (err) {
      if (p < lastPort && await isOurServer(p)) {   // 该端口其实是另一个工作台实例
        activePort = p;
        return openUI();
      }
      console.warn(`端口 ${p} 不可用（${err.message}），继续尝试下一个`);
    }
  }
  dialog.showErrorBox('个人工作台', `端口 ${DEFAULT_PORT}~${lastPort} 都被占用，本地服务无法启动。\n请关掉占用端口的程序后重试。`);
  app.quit();
}

function openUI() {
  createWindow();
  createTray();
}

/* 记住窗口大小与位置：下次打开在原处，不用每次拖 */
let stateFile = '';
function loadWinState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; }
}
function saveWinState() {
  try {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile, JSON.stringify({ ...b, maximized: win.isMaximized() }), 'utf8');
  } catch { /* 记不住也不影响使用 */ }
}

/* 上次的位置可能已经不在了（拔掉副屏、改了缩放、分辨率变了）：
   要求标题栏附近还有一块落在某个显示器里，否则交给系统重新摆 */
function visibleOnSomeDisplay(b) {
  if (typeof b.x !== 'number' || typeof b.y !== 'number') return false;
  try {
    return screen.getAllDisplays().some(({ workArea: a }) =>
      b.x + b.width - 80 > a.x && b.x + 80 < a.x + a.width &&
      b.y + 30 > a.y && b.y + 30 < a.y + a.height);
  } catch { return false; }
}

function createWindow() {
  stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const saved = loadWinState();
  // 只有尺寸合理才采用，防止上次是在小屏/异屏留下的怪值
  const useSaved = saved && saved.width >= 960 && saved.height >= 600;
  const usePos = useSaved && visibleOnSomeDisplay(saved);

  win = new BrowserWindow({
    width: useSaved ? saved.width : 1280,
    height: useSaved ? saved.height : 820,
    x: usePos ? saved.x : undefined,
    y: usePos ? saved.y : undefined,
    minWidth: 960,
    minHeight: 600,
    icon: path.join(ROOT, 'app.ico'),
    backgroundColor: '#FAF9F7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadURL(`http://127.0.0.1:${activePort}/`);

  // 外部链接交给系统浏览器，且只放行 http/https
  const isSafeExternal = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 窗口内跳转也只允许留在本地工作台，其余一律拦下
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(`http://127.0.0.1:${activePort}/`) || url === `http://127.0.0.1:${activePort}`) return;
    e.preventDefault();
    if (isSafeExternal(url)) shell.openExternal(url);
  });

  // 拖拽/缩放时防抖保存（关窗再存的话，强制结束进程就丢了）
  let saveTimer = null;
  const queueSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveWinState, 600); };
  win.once('ready-to-show', queueSave);
  win.on('resize', queueSave);
  win.on('move', queueSave);
  win.on('close', saveWinState);

  win.on('closed', () => { win = null; });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'app.ico'));
  tray = new Tray(icon);
  tray.setToolTip(`个人工作台 · http://127.0.0.1:${activePort}`);

  const menu = Menu.buildFromTemplate([
    { label: '打开工作台', click: () => { if (!win) createWindow(); win.show(); win.focus(); } },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => { if (!win) createWindow(); win.show(); win.focus(); });
}

// 关掉窗口时退到托盘，不退出应用
app.on('window-all-closed', () => {
  if (!tray) app.quit();
});

app.on('before-quit', () => {
  if (server && server.close) {
    try { server.close(); } catch { /* 已关闭 */ }
  }
});

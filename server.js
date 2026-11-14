const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 8733;
let WHITELIST_FILE = path.join(ROOT, '.workbench-whitelist.json');

/* 版本号只认 package.json，页面和安装包不会对不上 */
const APP_VERSION = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || ''); }
  catch { return ''; }
})();

/* 每次启动换一把随机令牌，随页面下发；本机其它程序猜不到，就调不动接口 */
const TOKEN = crypto.randomBytes(18).toString('hex');
const MAX_BODY = 2 * 1024 * 1024;   // 2MB，装 Skill 时内容可能较大

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2'
};

/* ---------- 信任根目录（白名单） ---------- */
function loadRoots() {
  try {
    const r = JSON.parse(fs.readFileSync(WHITELIST_FILE, 'utf8'));
    // 老版本可能登记过整块磁盘 / 用户目录本身，读的时候顺手剔掉
    return Array.isArray(r) ? r.filter(x => typeof x === 'string' && !isForbiddenRoot(x)) : [];
  } catch { return []; }
}
function saveRoots(rs) {
  try {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.writeFileSync(WHITELIST_FILE, JSON.stringify(rs, null, 2), 'utf8');
  } catch (e) { console.error('保存白名单失败:', e.message); }
}
let ROOTS = loadRoots();

function normAbs(p) {
  const r = path.resolve(String(p || ''));
  return process.platform === 'win32' ? r.toLowerCase() : r;
}
function inRoots(target) {
  const t = normAbs(target);
  // 工作台自身始终信任
  if (t.startsWith(normAbs(ROOT) + path.sep) || t === normAbs(ROOT)) return true;
  return ROOTS.some(r => t.startsWith(normAbs(r) + path.sep) || t === normAbs(r));
}

/* ---------- 启动外部应用（脱离） ---------- */

/* Windows 命令行参数转义：每个参数强制加引号，
   避免路径里的 & | ^ 等被 cmd 当成命令分隔符执行 */
function quoteWin(s) {
  return '"' + String(s).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

function openWith(app, args) {
  const safeApps = { cursor: 'cursor', vscode: 'code', code: 'code' };
  const cmd = safeApps[String(app || '').toLowerCase()];
  if (!cmd) throw new Error('未知应用：' + app);
  // cmd.exe 会展开 %VAR%，含 % 的路径直接拒绝；控制字符一律不收
  for (const a of args) {
    const s = String(a);
    if (s.includes('%')) {
      const e = new Error('路径中含 % ，无法安全传给命令行，请重命名后再试');
      e.status = 400;
      throw e;
    }
    if (/[\x00-\x1f]/.test(s)) {
      const e = new Error('路径含不可见字符，请重命名后再试');
      e.status = 400;
      throw e;
    }
  }
  const line = [cmd, ...args.map(quoteWin)].join(' ');
  const child = spawn('cmd.exe', ['/d', '/s', '/c', line], {
    detached: true, stdio: 'ignore', windowsHide: true
  });
  child.on('error', e => console.error('启动失败:', e.message));
  child.unref();
  return true;
}

/* ---------- 路径策略 ---------- */

function sysDirs() {
  return [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData]
    .filter(Boolean).map(normAbs);
}

/* 盘符根、UNC、系统目录、用户主目录本身：一律不许登记成信任根 */
function isForbiddenRoot(p) {
  const t = normAbs(p);
  if (t === path.parse(t).root) return true;          // C:\ 、D:\
  if (t.startsWith('\\\\')) return true;              // \\server\share
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home && t === normAbs(home)) return true;       // 整个用户目录太宽
  return sysDirs().some(s => t === s || t.startsWith(s + path.sep));
}

/* 只允许在用户目录或已登记的根目录里新建目录，避免凭空造出 C:\a\b\c */
function canMkdir(p) {
  const t = normAbs(p);
  const home = normAbs(process.env.USERPROFILE || process.env.HOME || '');
  if (home && t.startsWith(home + path.sep)) return true;
  return ROOTS.some(r => t.startsWith(normAbs(r) + path.sep));
}

/* 错误信息脱敏：绝对路径不回传页面 */
function safeMsg(e, fallback = '请求失败') {
  let m = String((e && e.message) || fallback);
  m = m.replace(/[A-Za-z]:\\[^\s'"]*/g, '<路径>')
       .replace(/\\\\[^\s'"]+/g, '<路径>')
       .replace(/(^|\s)\/[^\s'"]+/g, '$1<路径>');
  return m.length > 200 ? m.slice(0, 200) + '…' : m;
}

/* ---------- HTTP ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0;
    let done = false;
    const chunks = [];
    req.on('data', c => {
      if (done) return;                    // 超限后丢弃剩余数据，但保留连接以便回 413
      n += c.length;
      if (n > MAX_BODY) {
        done = true;
        chunks.length = 0;
        const e = new Error('请求体过大（上限 2MB）');
        e.status = 413;
        reject(e);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

/* 页面资源的安全头：脚本只许同源，禁止被任何页面内嵌 */
const STATIC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",     // 页面大量用 style="..." 内联样式
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
};

/* ---------- 来源校验 ---------- */
// POST 一定带 Origin：与 Host 不一致即视为外部网页调用。无 Origin 的是本机脚本，放行。
function isSameOrigin(req) {
  const src = req.headers.origin || req.headers.referer;
  if (!src) return true;
  try {
    const u = new URL(src);
    const host = req.headers.host || '';
    return !!host && u.host === host;
  } catch { return false; }
}

/* ---------- 只接受本机 Host ---------- */
// 只比 Origin 会漏掉 DNS rebinding（Origin 与 Host 同为攻击者域名），故限定回环地址。
function boundPort() {
  try { const a = server.address(); return a ? String(a.port) : String(PORT); } catch { return String(PORT); }
}
function isLocalHost(req) {
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(String(req.headers.host || ''));
  if (!m) return false;
  const name = m[1].toLowerCase();
  const port = m[2] || '80';
  const local = name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1';
  return local && port === boundPort();
}

const server = http.createServer(async (req, res) => {
  const u = req.url.split('?')[0];

  // --- Host 校验：只认回环地址，挡 DNS rebinding ---
  if (!isLocalHost(req)) {
    return send(res, 403, { error: '只接受本机访问' });
  }

  // --- 来源校验：拒绝外部网页跨站调用本机服务 ---
  if (req.method === 'POST' && !isSameOrigin(req)) {
    return send(res, 403, { error: '拒绝跨站调用：请从工作台页面发起请求' });
  }

  // --- 令牌校验：页面带着启动时下发的令牌，本机其它程序没有就跑不动（ping 给启动器留白） ---
  if (u.startsWith('/api/') && u !== '/api/ping') {
    const got = String(req.headers['x-wb-token'] || '');
    const ok = got.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(TOKEN));
    if (!ok) return send(res, 401, { error: '本机令牌无效，请刷新工作台页面后重试' });
  }

  // --- API ---
  // 启动器用它确认端口上的服务是不是自己
  if (u === '/api/ping' && req.method === 'GET') {
    return send(res, 200, { app: 'personal-workbench', version: 1 });
  }
  if (u === '/api/roots' && req.method === 'GET') {
    return send(res, 200, { roots: ROOTS });
  }
  if (u === '/api/roots' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const add = Array.isArray(body.add) ? body.add : [];
      const remove = Array.isArray(body.remove) ? body.remove : [];
      const mkdir = !!body.mkdir;
      const set = new Set(ROOTS);
      const rejected = [];
      for (const p of add) {
        if (typeof p !== 'string' || !p.trim()) continue;
        const a = path.resolve(p);
        // 被拒的放 rejected 里回给页面：整块磁盘、系统目录、不存在的路径都不登记
        if (isForbiddenRoot(a)) { rejected.push(a); continue; }
        if (!fs.existsSync(a)) {
          // 首次装 Skill 时 ~/.cursor/skills 可能还不存在：只允许在用户目录/已登记目录里建
          if (!mkdir || !canMkdir(a)) { rejected.push(a); continue; }
          try { fs.mkdirSync(a, { recursive: true }); } catch { rejected.push(a); continue; }
        }
        let st;
        try { st = fs.statSync(a); } catch { rejected.push(a); continue; }
        if (!st.isDirectory()) { rejected.push(a); continue; }
        set.add(a);
      }
      for (const p of remove) if (typeof p === 'string' && p) set.delete(path.resolve(p));
      ROOTS = [...set];
      saveRoots(ROOTS);
      const out = { ok: true, roots: ROOTS };
      if (rejected.length) out.rejected = rejected;
      return send(res, 200, out);
    } catch (e) { return send(res, e.status || 400, { error: safeMsg(e) }); }
  }
  if (u === '/api/open' && req.method === 'POST') {
    try {
      const { app, target, line } = await readBody(req);
      if (!target) return send(res, 400, { error: '缺少 target' });
      const abs = path.resolve(String(target));
      if (!fs.existsSync(abs)) return send(res, 404, { error: '路径不存在' });
      if (!inRoots(abs)) return send(res, 403, { error: '目标不在信任根目录下，请先在「系统设置」里连接/登记该目录' });
      const st = fs.statSync(abs);
      const ln = Number(line);
      const args = [];
      if (st.isFile() && Number.isFinite(ln) && ln > 0 && ln < 1e7) {
        args.push('--goto', abs + ':' + Math.floor(ln));
      } else if (st.isFile()) {
        args.push('--goto', abs);
      } else {
        args.push(abs);
      }
      openWith(app, args);
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, e.status || 400, { error: safeMsg(e) }); }
  }
  if (u === '/api/shell' && req.method === 'POST') {
    // 受限的 shell：仅允许做几件工作台自身的事（写快照、安装 skill 等）
    try {
      const { op, payload } = await readBody(req);
      if (op === 'reveal-in-explorer') {
        if (!payload || !payload.target) return send(res, 400, { error: '缺少 target' });
        const t = path.resolve(String(payload.target));
        if (!inRoots(t)) return send(res, 403, { error: '目标不在信任根目录下' });
        if (!fs.existsSync(t)) return send(res, 404, { error: '路径不存在' });
        spawn('explorer.exe', [t], { detached: true, stdio: 'ignore' }).unref();
        return send(res, 200, { ok: true });
      }
      if (op === 'install-cursor-user-skills') {
        if (!payload || !Array.isArray(payload.skills)) return send(res, 400, { error: '缺少 skills' });
        if (payload.skills.length > 500) return send(res, 400, { error: '一次最多装 500 个 Skill' });
        const home = process.env.USERPROFILE || process.env.HOME;
        const dest = path.join(home, '.cursor', 'skills');
        // 未登记就拒绝，本接口不再自行扩权
        if (!inRoots(dest)) {
          return send(res, 403, { error: '目标目录未登记为信任目录：' + dest, needsRoot: dest });
        }
        ensureRealDir(dest);
        let count = 0;
        const skipped = [];
        for (const s of payload.skills) {
          try {
            const dir = path.join(dest, sanitize(s.name || ('skill-' + count)));
            // 兜底：最终目录必须真在 dest 之下
            const rel = path.relative(dest, dir);
            if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { skipped.push(String(s && s.name)); continue; }
            ensureRealDir(dir);                      // 已存在且是符号链接时抛错，避免写到别处
            fs.writeFileSync(path.join(dir, 'SKILL.md'), String(s.content || ''), 'utf8');
            count++;
          } catch { skipped.push(String(s && s.name || '')); }
        }
        return send(res, 200, { ok: true, installed: count, skipped, dest });
      }
      if (op === 'reveal-cursor-user-config') {
        const home = process.env.USERPROFILE || process.env.HOME;
        const cfg = path.join(home, '.cursor');
        if (!fs.existsSync(cfg)) return send(res, 404, { error: '还没有 Cursor 配置目录，先启动一次 Cursor 再试' });
        spawn('explorer.exe', [cfg], { detached: true, stdio: 'ignore' }).unref();
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { error: '未知操作' });
    } catch (e) { return send(res, e.status || 400, { error: safeMsg(e) }); }
  }

  // --- 静态文件 ---
  let p;
  try { p = decodeURIComponent(u); }
  catch { return send(res, 400, { error: '请求路径不合法' }); }
  if (p === '/') p = '/index.html';
  // 空字节/控制字符会让 fs 同步抛错、把进程带下去，必须在碰磁盘前挡掉
  if (/[\x00-\x1f]/.test(p)) return send(res, 400, { error: '请求路径不合法' });
  try {
    const file = path.join(ROOT, p);
    // 用 path.relative 判断越界：字符串前缀会把 xxx-other 当成内部
    const rel = path.relative(ROOT, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403).end('forbidden'); return; }
    const segs = rel.split(/[\\/]/);
    // 隐藏文件不对外提供（白名单、.git 等）
    if (segs.some(seg => seg.startsWith('.')) || isDeniedStatic(segs)) {
      return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
    }
    // 首页要带上本次启动的令牌（放在 meta 里，不破坏 CSP）
    if (rel === 'index.html') {
      return fs.readFile(file, 'utf8', (err, html) => {
        if (err) return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
        const out = html.replace('</head>', `<meta name="wb-token" content="${TOKEN}">\n<meta name="wb-version" content="${APP_VERSION}">\n</head>`);
        res.writeHead(200, { ...STATIC_HEADERS, 'Content-Type': MIME['.html'], 'Content-Length': Buffer.byteLength(out) });
        res.end(out);
      });
    }
    fs.readFile(file, (err, buf) => {
      if (err) return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
      res.writeHead(200, {
        ...STATIC_HEADERS,
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
      });
      res.end(buf);
    });
  } catch {
    return send(res, 500, { error: '读取文件失败' });
  }
});

/* 源码与启动脚本不通过 HTTP 暴露 */
const DENY_FILES = new Set(['server.js', 'package.json', 'package-lock.json', 'tray.ps1', 'start-workbench.bat', 'start-workbench.vbs', 'readme.md']);
const DENY_DIRS = new Set(['electron', 'node_modules', 'release', 'docs', 'shots']);
function isDeniedStatic(segs) {
  const first = String(segs[0] || '').toLowerCase();
  if (DENY_DIRS.has(first)) return true;
  return segs.length === 1 && DENY_FILES.has(first);
}

/* 建目录但不跟随链接：已存在且是符号链接/联接就报错，避免被引到别处写文件 */
function ensureRealDir(dir) {
  if (fs.existsSync(dir)) {
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) {
      const e = new Error('目标目录不可写（符号链接或非目录）');
      e.status = 400;
      throw e;
    }
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitize(n) {
  const s = String(n || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[. ]+$/, '')          // Windows 会吃掉结尾的点和空格
    .slice(0, 60);
  // 纯点号会被 path.join 当成当前/上级目录；设备名不可用；空名兜底
  if (!s || /^\.+$/.test(s) || RESERVED.test(s)) return 'skill';
  return s;
}

/* ---------- 启动 ---------- */
function startServer({ port = PORT, dataDir = ROOT } = {}) {
  if (path.resolve(dataDir) !== path.resolve(ROOT)) {
    fs.mkdirSync(dataDir, { recursive: true });
    WHITELIST_FILE = path.join(dataDir, '.workbench-whitelist.json');
    ROOTS = loadRoots();
  }
  return new Promise((resolve, reject) => {
    const onError = (e) => { server.off('listening', onListening); reject(e); };
    const onListening = () => {
      server.off('error', onError);
      console.log(`工作台 v${APP_VERSION || '?'} 已启动：http://127.0.0.1:${port}`);
      console.log('只监听本机 127.0.0.1，完全不联网。');
      console.log(`信任根目录数：${ROOTS.length}${ROOTS.length ? '（' + ROOTS.join('，') + '）' : ''}`);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

if (require.main === module) {
  startServer({ port: PORT }).catch((e) => {
    console.error('启动失败：' + e.message);
    process.exitCode = 1;
  });
}

module.exports = { startServer };
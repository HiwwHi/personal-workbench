const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 8733;
let WHITELIST_FILE = path.join(ROOT, '.workbench-whitelist.json');

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
    return Array.isArray(r) ? r.filter(x => typeof x === 'string') : [];
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
  // cmd.exe 会展开 %VAR%，含 % 的路径直接拒绝
  for (const a of args) {
    if (String(a).includes('%')) {
      const e = new Error('路径中含 % ，无法安全传给命令行，请重命名后再试');
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

/* ---------- HTTP ---------- */
const MAX_BODY = 2 * 1024 * 1024;   // 2MB，装 Skill 时内容可能较大

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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

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
      const { add = [], remove = [], mkdir = false } = await readBody(req);
      const set = new Set(ROOTS);
      add.forEach(p => {
        const a = path.resolve(String(p || ''));
        // mkdir：首次安装时目标目录可能还不存在
        if (mkdir && !fs.existsSync(a)) { try { fs.mkdirSync(a, { recursive: true }); } catch {} }
        if (fs.existsSync(a)) set.add(a);
      });
      remove.forEach(p => set.delete(path.resolve(String(p || ''))));
      ROOTS = [...set];
      saveRoots(ROOTS);
      return send(res, 200, { ok: true, roots: ROOTS });
    } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  }
  if (u === '/api/open' && req.method === 'POST') {
    try {
      const { app, target, line } = await readBody(req);
      if (!target) return send(res, 400, { error: '缺少 target' });
      const abs = path.resolve(String(target));
      if (!fs.existsSync(abs)) return send(res, 404, { error: '路径不存在' });
      if (!inRoots(abs)) return send(res, 403, { error: '目标不在信任根目录下，请先在「系统设置」里连接/登记该目录' });
      const args = [];
      if (fs.statSync(abs).isFile() && typeof line === 'number' && line > 0) {
        args.push('--goto', abs + ':' + Math.floor(line));
      } else if (fs.statSync(abs).isFile()) {
        args.push('--goto', abs);
      } else {
        args.push(abs);
      }
      openWith(app, args);
      return send(res, 200, { ok: true, args: [app, ...args] });
    } catch (e) { return send(res, e.status || 400, { error: e.message }); }
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
        const home = process.env.USERPROFILE || process.env.HOME;
        const dest = path.join(home, '.cursor', 'skills');
        // 未登记就拒绝，本接口不再自行扩权
        if (!inRoots(dest)) {
          return send(res, 403, { error: '目标目录未登记为信任目录：' + dest, needsRoot: dest });
        }
        fs.mkdirSync(dest, { recursive: true });
        let count = 0;
        const skipped = [];
        for (const s of payload.skills) {
          const dir = path.join(dest, sanitize(s.name || ('skill-' + count)));
          // 兜底：最终目录必须真在 dest 之下
          const rel = path.relative(dest, dir);
          if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { skipped.push(String(s && s.name)); continue; }
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'SKILL.md'), String(s.content || ''), 'utf8');
          count++;
        }
        return send(res, 200, { ok: true, installed: count, skipped, dest });
      }
      if (op === 'reveal-cursor-user-config') {
        const home = process.env.USERPROFILE || process.env.HOME;
        const cfg = path.join(home, '.cursor');
        if (!fs.existsSync(cfg)) return send(res, 404, { error: '目录不存在：' + cfg });
        spawn('explorer.exe', [cfg], { detached: true, stdio: 'ignore' }).unref();
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { error: '未知操作：' + op });
    } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  }

  // --- 静态文件 ---
  let p;
  try { p = decodeURIComponent(u); }
  catch { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('400'); return; }
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  // 用 path.relative 判断越界：字符串前缀会把 xxx-other 当成内部
  const rel = path.relative(ROOT, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403).end('forbidden'); return; }
  // 隐藏文件不对外提供（白名单、.git 等）
  if (rel.split(/[\\/]/).some(seg => seg.startsWith('.'))) {
    return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
});

function sanitize(n) {
  const s = String(n || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\s+/g, '_').slice(0, 60);
  // 纯点号会被 path.join 当成当前/上级目录
  if (!s || /^\.+$/.test(s)) return 'skill';
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
      console.log(`工作台已启动：http://127.0.0.1:${port}`);
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
#!/usr/bin/env node
/*
 * 自检：起一个临时服务，跑几条关键断言，然后退出。
 * 不写任何文件（不做会保存白名单的调用），也不联网。
 * 用法：npm run selfcheck   端口被占时：SELFCHECK_PORT=8888 npm run selfcheck
 */
const http = require('http');
const { startServer } = require('../server.js');

let base = '';

function request(method, pathname, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathname);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail: detail || '' }); }

(async () => {
  const startPort = Number(process.env.SELFCHECK_PORT) || 8799;
  let server = null;
  for (let p = startPort; p < startPort + 10 && !server; p++) {
    try {
      server = await startServer({ port: p });
      base = 'http://127.0.0.1:' + p;
    } catch { /* 端口被占，换下一个 */ }
  }
  if (!server) {
    console.error(`错误：${startPort}~${startPort + 9} 都被占用，换个端口再试：SELFCHECK_PORT=8888 npm run selfcheck`);
    process.exit(1);
  }

  try {
    const home = await request('GET', '/');
    const token = (home.body.match(/name="wb-token" content="([0-9a-f]+)"/) || [])[1] || '';
    check('首页可访问', home.status === 200);
    check('首页注入了本机令牌', token.length === 36, token ? '已注入' : '缺失');
    check('首页注入了版本号', /name="wb-version" content="[^"]+"/.test(home.body));
    check('安全响应头齐全', /script-src 'self'/.test(home.headers['content-security-policy'] || ''));

    const app = await request('GET', '/assets/js/app.js');
    check('前端资源可访问', app.status === 200 && /javascript/.test(app.headers['content-type'] || ''));

    const ping = await request('GET', '/api/ping');
    check('本地服务身份正常', ping.status === 200 && ping.body.indexOf('personal-workbench') >= 0);

    const src = await request('GET', '/server.js');
    check('源码不对外提供', src.status === 404);

    const noToken = await request('POST', '/api/roots', {
      headers: { 'Content-Type': 'application/json' },
      body: '{"add":[]}'
    });
    check('未带令牌的写操作被拒', noToken.status === 401);

    const evilHost = await request('GET', '/', { headers: { Host: 'evil.example' } });
    check('非本机 Host 被拒', evilHost.status === 403);
  } finally {
    server.close();
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  ' + r.detail : ''}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('自检异常：' + ((e && e.message) || e));
  process.exit(1);
});

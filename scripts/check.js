#!/usr/bin/env node
/*
 * 语法检查：把每个前端 .js 复制成 .mjs 交给 node --check（ES module 的 .js 直接 --check 会被当 CJS）。
 * 临时文件建在系统临时目录，跑完删掉，不碰项目目录。也不联网。
 * 用法：npm run check（之后还会跑一遍 selfcheck）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function collect(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full, out);
    else if (/\.js$/i.test(e.name)) out.push(full);
  }
}

function check(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return true;
  } catch (e) {
    const msg = String((e.stderr && e.stderr.toString()) || e.message || '');
    console.error('  ' + msg.split('\n').slice(0, 3).join('\n  '));
    return false;
  }
}

const front = [];
collect(path.join(ROOT, 'assets', 'js'), front);
// node 侧脚本：CJS，直接 --check
const nodeFiles = ['server.js', 'electron/main.js', 'electron/preload.js', 'scripts/selfcheck.js', 'scripts/check.js', 'scripts/changelog-section.js']
  .map(f => path.join(ROOT, f))
  .filter(f => fs.existsSync(f));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-check-'));
let bad = 0;
try {
  for (const f of front) {
    const copy = path.join(tmp, 'x.mjs');
    fs.copyFileSync(f, copy);
    if (!check(copy)) { bad++; console.error('语法错误：' + path.relative(ROOT, f)); }
  }
  for (const f of nodeFiles) {
    if (!check(f)) { bad++; console.error('语法错误：' + path.relative(ROOT, f)); }
  }
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 删不掉也不影响结果 */ }
}

if (bad) {
  console.error(`\n${bad} 个文件没过语法检查`);
  process.exit(1);
}
console.log(`语法检查通过：${front.length} 个前端模块 + ${nodeFiles.length} 个 node 脚本`);

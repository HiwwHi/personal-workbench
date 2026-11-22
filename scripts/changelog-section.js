#!/usr/bin/env node
/*
 * 从 CHANGELOG.md 抽出某个版本的段落，写进 GitHub Release 正文。
 * 用法：node scripts/changelog-section.js v1.0.6
 *
 * 为什么不用 action 自带的 generate_release_notes：它按 PR 标签分类，
 * 而这项目的提交是直推 main 的，生成出来只有一个 Full Changelog 链接。
 */
const fs = require('fs');
const path = require('path');

const tag = String(process.argv[2] || '').trim();
if (!tag) {
  console.error('用法：node scripts/changelog-section.js v1.0.6');
  process.exit(1);
}
const ver = tag.replace(/^v/i, '');
const file = path.join(__dirname, '..', 'CHANGELOG.md');

let text = '';
try {
  text = fs.readFileSync(file, 'utf8');
} catch {
  console.log('详细改动见 CHANGELOG.md。');
  process.exit(0);
}

const lines = text.split('\n');
const esc = ver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const start = lines.findIndex(l => new RegExp('^##\\s+v?' + esc + '(\\s|$)').test(l));

if (start < 0) {
  // 找不到就退化成一句指向文件的话，别让整个发布步骤挂掉
  console.log('详细改动见 [CHANGELOG.md](https://github.com/HiwwHi/personal-workbench/blob/main/CHANGELOG.md)。');
  process.exit(0);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s/.test(lines[i])) { end = i; break; }
}

const body = lines.slice(start + 1, end).join('\n').trim();
console.log(body || '这一版没有列改动。');

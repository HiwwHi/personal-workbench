import { esc } from './ui.js';

/* 链接只放行 http/https/mailto 和相对路径：javascript:、data:、file: 一律不认 */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
function safeUrl(u) {
  const s = String(u || '').trim();
  if (/^(https?:|mailto:)/i.test(s)) return s;
  if (SCHEME_RE.test(s)) return '';
  return s;                       // 相对路径、#锚点
}

function inline(s) {
  const stash = [];
  const put = html => { stash.push(html); return '@S' + (stash.length - 1) + 'S@'; };
  s = s.replace(/`([^`]+)`/g, (m, c) => put('<code>' + c + '</code>'));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, a, u) => {
    const src = safeUrl(u);
    return src ? put('<img src="' + src + '" alt="' + a + '">') : m;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, u) => {
    const href = safeUrl(u);
    return href ? put('<a href="' + href + '" target="_blank" rel="noreferrer noopener">' + a + '</a>') : a;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/@S(\d+)S@/g, (m, n) => stash[Number(n)]);
  return s;
}

function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
}

function buildTable(head, rows) {
  const th = head.map(h => '<th>' + inline(esc(h)) + '</th>').join('');
  const tb = rows.map(r => '<tr>' + r.map(c => '<td>' + inline(esc(c)) + '</td>').join('') + '</tr>').join('');
  return '<table><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table>';
}

const SEP_RE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const ROWSEP_RE = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

export function render(src) {
  const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
  const isTableStart = idx => lines[idx] && lines[idx].indexOf('|') >= 0 && idx + 1 < lines.length && ROWSEP_RE.test(lines[idx + 1]);
  const isBlockStart = (l, idx) => /^(#{1,6}\s|>|```|\s*([-*+]|\d+\.)\s)/.test(l) || SEP_RE.test(l) || isTableStart(idx);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      const buf = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push('<h' + h[1].length + ' id="ln-' + i + '">' + inline(esc(h[2])) + '</h' + h[1].length + '>'); i++; continue; }
    if (SEP_RE.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<blockquote>' + render(buf.join('\n')) + '</blockquote>');
      continue;
    }
    if (isTableStart(i)) {
      const head = splitRow(line); i += 2;
      const rows = [];
      while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
      out.push(buildTable(head, rows));
      continue;
    }
    const ordered = /^\s*\d+\.\s+/.test(line);
    if (/^\s*([-*+])\s+/.test(line) || ordered) {
      const items = [];
      while (i < lines.length) {
        const m = ordered ? lines[i].match(/^\s*\d+\.\s+(.*)$/) : lines[i].match(/^\s*[-*+]\s+(.*)$/);
        if (!m) break;
        let txt = m[1], checked = null;
        const t = txt.match(/^\[([ xX])\]\s+(.*)$/);
        if (t) { checked = t[1].toLowerCase() === 'x'; txt = t[2]; }
        items.push({ txt, checked });
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push('<' + tag + '>' + items.map(it => {
        const cb = it.checked === null ? '' : '<input type="checkbox" disabled' + (it.checked ? ' checked' : '') + '> ';
        return '<li' + (it.checked === null ? '' : ' class="task"') + '>' + cb + inline(esc(it.txt)) + '</li>';
      }).join('') + '</' + tag + '>');
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], i)) { buf.push(lines[i]); i++; }
    out.push('<p>' + inline(esc(buf.join('\n'))).replace(/\n/g, '<br>') + '</p>');
  }
  return out.join('\n');
}

export function sliceDoc(src) {
  const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
  const heads = [];
  let inFence = false;
  lines.forEach((ln, idx) => {
    if (/^\s*```/.test(ln)) { inFence = !inFence; return; }
    if (inFence) return;
    const m = ln.match(/^(#{1,6})\s+(.*)$/);
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), line: idx });
  });
  const secs = [];
  const first = heads.length ? heads[0].line : lines.length;
  const pre = lines.slice(0, first);
  if (pre.join('').trim()) secs.push({ level: 0, title: '开头', start: 0, end: Math.max(0, first - 1), lines: pre });
  heads.forEach((h, i) => {
    const end = (i + 1 < heads.length ? heads[i + 1].line - 1 : lines.length - 1);
    secs.push({ level: h.level, title: h.title, start: h.line, end, lines: lines.slice(h.line, end + 1) });
  });
  return secs;
}

export function outline(src) {
  return sliceDoc(src).filter(s => s.level >= 1 && s.level <= 3);
}

export function trimLines(arr) {
  const a = arr.slice();
  while (a.length && !a[a.length - 1].trim()) a.pop();
  return a.join('\n');
}

export function toPlain(src) {
  return String(src == null ? '' : src)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ');
}

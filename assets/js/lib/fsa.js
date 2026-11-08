import * as store from './store.js';

const DB_NAME = 'wb-notes-fs';
const STORE = 'handles';

/* 槽位：work = 工作流程笔记，know = 知识笔记，runtime = 中间文件目录 */
export const SLOTS = ['work', 'know'];
export const SLOT_LABEL = { work: '工作流程笔记', know: '知识笔记' };
const KEY = { work: 'dir:work', know: 'dir:know', runtime: 'dir:runtime' };

export const supported = () => typeof window.showDirectoryPicker === 'function';

let handles = { work: null, know: null, runtime: null };

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, val) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbDel(key) {
  const db = await idb();
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve(true);
  });
}

export async function pickDir(slot = 'work') {
  if (!supported()) throw new Error('当前浏览器不支持文件夹直连，请用 Chrome / Edge');
  const h = await window.showDirectoryPicker({ id: 'wb-' + slot, mode: 'readwrite' });
  handles[slot] = h;
  await idbSet(KEY[slot], h);
  return h.name;
}

export async function restoreDir(slot = 'work', { silent = true } = {}) {
  if (!supported()) return null;
  if (handles[slot]) return handles[slot];
  try {
    const h = await idbGet(KEY[slot]);
    if (!h) return null;
    const opts = { mode: 'readwrite' };
    let perm = await h.queryPermission(opts);
    if (perm !== 'granted') {
      if (silent) return null;
      perm = await h.requestPermission(opts);
      if (perm !== 'granted') return null;
    }
    handles[slot] = h;
    return h;
  } catch (e) { return null; }
}

/* 目录绝对路径：File System Access API 拿不到路径，只能由用户在系统设置里手动填写 */
export function absPath(slot = 'work') {
  const paths = store.settings().dirPaths || {};
  const p = paths[slot];
  return typeof p === 'string' ? p.trim() : '';
}

export async function currentDir(slot = 'work') {
  const h = handles[slot] || await restoreDir(slot);
  if (!h) return null;
  return { name: h.name, root: absPath(slot) };
}

export function clearDir(slot = 'work') {
  handles[slot] = null;
  return idbDel(KEY[slot]);
}

async function walk(dir, prefix, depth, out) {
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith('.')) continue;
    const rel = prefix ? prefix + '/' + name : name;
    if (handle.kind === 'directory') {
      if (depth < 3) await walk(handle, rel, depth + 1, out);
    } else if (/\.md$/i.test(name)) {
      out.push({ name, path: rel, handle, parent: dir });
    }
  }
}

export async function listFiles(slot = 'work') {
  const root = await restoreDir(slot);
  if (!root) return [];
  const out = [];
  await walk(root, '', 1, out);
  out.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
  return out;
}

export async function readFile(fh) {
  const file = await fh.getFile();
  return { text: await file.text(), modified: file.lastModified };
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function writeTo(parent, name, content) {
  const fh = await parent.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
  return fh;
}

async function ensurePath(dir, rel) {
  let d = dir;
  for (const part of rel.split('/')) {
    if (!part) continue;
    d = await d.getDirectoryHandle(part, { create: true });
  }
  return d;
}

/* ---------- 运行时目录：所有中间文件都落在这里，笔记源目录保持干净 ---------- */

export class NoRuntimeError extends Error {
  constructor() { super('还没有选择「中间文件目录」'); this.code = 'NO_RUNTIME'; }
}

export async function runtimeReady() {
  return !!(await restoreDir('runtime'));
}

export async function runtimeName() {
  const h = await restoreDir('runtime');
  return h ? h.name : null;
}

/* 写入运行时目录的子目录，返回相对路径；未设置时抛 NO_RUNTIME */
export async function writeRuntime(sub, name, content) {
  const root = await restoreDir('runtime');
  if (!root) throw new NoRuntimeError();
  const dir = sub ? await ensurePath(root, sub) : root;
  await writeTo(dir, name, content);
  return sub ? `${sub}/${name}` : name;
}

export async function runtimePath() {
  const h = await restoreDir('runtime');
  if (!h) return null;
  return { name: h.name, root: absPath('runtime') };
}

/* ---------- 笔记文件操作 ---------- */

export async function saveWithBackup(slot, file, content, expectedModified) {
  const cur = await file.handle.getFile();
  if (typeof expectedModified === 'number' && Math.abs(cur.lastModified - expectedModified) > 1000) {
    return { conflict: true, diskModified: cur.lastModified };
  }
  const base = file.name.replace(/\.md$/i, '');
  const bakName = `${base}.${stamp()}.bak.md`;
  await writeRuntime('备份/' + (SLOT_LABEL[slot] || slot), bakName, cur.lastModified ? await cur.text() : '');
  await writeTo(file.parent, file.name, content);
  const nf = await file.handle.getFile();
  return { ok: true, modified: nf.lastModified, backup: `备份/${SLOT_LABEL[slot] || slot}/${bakName}` };
}

export async function createFile(slot, parentPath, name, content) {
  const root = await restoreDir(slot);
  if (!root) throw new Error('笔记文件夹未连接');
  let target = root;
  if (parentPath) target = await ensurePath(root, parentPath);
  return writeTo(target, name, content);
}

export async function moveToTrash(slot, file) {
  const content = await (await file.handle.getFile()).text();
  const name = (SLOT_LABEL[slot] || slot) + '__' + file.path.replace(/\//g, '__');
  const rel = await writeRuntime('回收站', name, content);
  await file.handle.remove();
  return rel;
}

export async function fileUrl(file) {
  const f = await file.handle.getFile();
  return URL.createObjectURL(f);
}

const KEY = 'wb.data.v1';

const DEFAULT = {
  vault: [],
  projects: [],
  study: [],
  skills: [],
  jots: [],
  health: { rules: [], logs: {}, settings: {} },
  notesUI: {
    recent: {}, recentOrder: [], lastNote: null, pendingOpen: null,
    slots: {
      work: { recent: {}, recentOrder: [], last: null, source: '' },
      know: { recent: {}, recentOrder: [], last: null, source: '' }
    }
  },
  settings: {
    clipboardClear: 15,
    theme: 'chenwu',
    homeHealth: false,     // 首页默认不显示健康环，避免被同事看到
    homeStudy: true,
    homeNotes: true,
    privacy: false,        // 隐私模式：隐藏密码 / 健康 / 随手记
    notesSlot: 'work',
    accent: '',           // 自定义主色（留空=用主题原色）
    // 目录绝对路径：浏览器 FSA 只能拿到文件夹名，拿不到路径，需要手动填写
    dirPaths: { work: '', know: '', runtime: '' }
  }
};

let cache = null;

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function load() {
  if (cache) return cache;
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { }
  let obj = {};
  if (raw) { try { obj = JSON.parse(raw); } catch (e) { obj = {}; } }
  cache = deepMerge(DEFAULT, obj);
  return cache;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(load())); }
  catch (e) { console.error(e); }
}

export function slice(name) { return load()[name]; }

export function settings() { return load().settings; }

export function setSetting(k, v) { return update(d => { d.settings[k] = v; }); }

/* 笔记两个槽位各自的最近浏览记录 */
export function notesSlotUI(slot = 'work') {
  const ui = load().notesUI;
  ui.slots = ui.slots || {};
  if (!ui.slots[slot]) ui.slots[slot] = { recent: {}, recentOrder: [], last: null, source: '' };
  const s = ui.slots[slot];
  s.recent = s.recent || {};
  s.recentOrder = s.recentOrder || [];
  return s;
}

export function commitNotesSlot(slot) { save(); return notesSlotUI(slot); }

export function update(fn) {
  const d = load();
  fn(d);
  save();
  return d;
}

export function exportAll() {
  return JSON.stringify({ __app: 'personal-workbench', version: 1, exportedAt: new Date().toISOString(), data: load() }, null, 2);
}

export function importAll(json) {
  const obj = JSON.parse(json);
  const data = obj && obj.data ? obj.data : obj;
  cache = deepMerge(DEFAULT, data);
  save();
  return true;
}

export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'absolute'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    return ok;
  }
}

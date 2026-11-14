import * as store from './store.js';
import * as fsa from './fsa.js';
import { toast } from './ui.js';

/* 自动备份：数据变动后最多每 10 分钟写一份到「中间文件目录/备份/json/」，只留最近 10 份 */

export const SUB = '备份/json';
export const KEEP = 10;
const MIN_GAP = 10 * 60 * 1000;      // 两次自动备份的最小间隔
const PREFIX = '工作台自动备份-';

let timer = null;

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function lastAt() { return Number(store.settings().lastAutoBackup) || 0; }

/* 只清理自己产生的文件，且只留最新 KEEP 份；失败不影响主流程 */
async function prune() {
  const files = await fsa.listRuntime(SUB);
  const mine = files.filter(n => n.startsWith(PREFIX) && n.endsWith('.json')).sort();
  const extra = mine.slice(0, Math.max(0, mine.length - KEEP));
  for (const n of extra) { try { await fsa.removeRuntime(SUB, n); } catch {} }
}

export async function backupNow({ silent = false } = {}) {
  if (!(await fsa.runtimeReady())) {
    if (silent) return null;
    throw new Error('还没设置「中间文件目录」，自动备份需要一个落脚点');
  }
  const name = PREFIX + stamp() + '.json';
  await fsa.writeRuntime(SUB, name, store.exportAll());
  store.update(d => { d.settings.lastAutoBackup = Date.now(); });
  try { await prune(); } catch {}
  if (!silent) toast('已备份到「中间文件目录/' + SUB + '」', 'ok');
  return name;
}

/* 监听数据变化：限频 + 3 秒防抖，连续编辑时不会频繁写盘 */
export function setup() {
  window.addEventListener('wb:saved', () => {
    if (store.settings().autoBackup === false) return;
    if (Date.now() - lastAt() < MIN_GAP) return;
    clearTimeout(timer);
    timer = setTimeout(() => { backupNow({ silent: true }).catch(() => {}); }, 3000);
  });
}

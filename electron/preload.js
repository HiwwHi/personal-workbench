const { contextBridge, ipcRenderer } = require('electron');

/* 页面只拿到「选目录」这一项能力：浏览器 API 给不了真实路径，只能借主进程的原生选择框 */
contextBridge.exposeInMainWorld('workbenchDesktop', {
  pickDir: (defaultPath) => ipcRenderer.invoke('wb:pick-dir', typeof defaultPath === 'string' ? defaultPath : '')
});

// Preload exposes a small, safe API for saving/loading playlist and cache
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  savePlaylist: (playlist) => ipcRenderer.invoke('save-playlist', playlist),
  loadPlaylist: () => ipcRenderer.invoke('load-playlist'),
  saveCache: (cacheObj) => ipcRenderer.invoke('save-cache', cacheObj),
  loadCache: () => ipcRenderer.invoke('load-cache'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 620,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC handlers for saving/loading playlist
ipcMain.handle('save-playlist', async (event, playlist) => {
  try {
    const dir = app.getPath('userData');
    const filePath = path.join(dir, 'playlist.json');
    await fs.promises.writeFile(filePath, JSON.stringify(playlist, null, 2), 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('load-playlist', async (event) => {
  try {
    const dir = app.getPath('userData');
    const filePath = path.join(dir, 'playlist.json');
    const content = await fs.promises.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    return { ok: true, playlist: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// IPC handlers for saving/loading anime cover cache
ipcMain.handle('save-cache', async (event, cacheObj) => {
  try {
    const dir = app.getPath('userData');
    const filePath = path.join(dir, 'cache.json');
    await fs.promises.writeFile(filePath, JSON.stringify(cacheObj, null, 2), 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('load-cache', async (event) => {
  try {
    const dir = app.getPath('userData');
    const filePath = path.join(dir, 'cache.json');
    const content = await fs.promises.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    return { ok: true, cache: data };
  } catch (err) {
    // if file missing, return empty cache
    return { ok: false, error: err.message };
  }
});

// open external URL in the user's default browser
ipcMain.handle('open-external', async (event, url) => {
  try {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

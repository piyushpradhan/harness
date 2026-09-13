import { join } from 'node:path'

import { BrowserWindow, app, ipcMain } from 'electron'
import { setAuth, getAuth } from "./services/auth";
import { listProviders } from "./services/providers";
import { chat } from './services/llm';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    frame: true,
    transparent: true,
    vibrancy: 'fullscreen-ui',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Dev: electron-vite serves the renderer from its dev server (with HMR).
  // Prod: load the built file from out/renderer.
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

ipcMain.handle("auth:set", (_e, providerID: string, key: string) => setAuth(providerID, key.trim()));
ipcMain.handle("auth:get", (_e, providerID: string) => getAuth(providerID));
ipcMain.handle("providers:list", () => listProviders());
ipcMain.handle("auth:test", async (_e, providerID: string) => {          // verify key actually works
  try { await chat(providerID, "models", "ping"); return true; }
  catch { return false; }
});

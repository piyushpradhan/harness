import { join } from 'node:path'

import { BrowserWindow, app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { setAuth, getAuth } from './services/auth'
import { listProviders } from './services/providers'
import { chat } from './services/llm'

import type { WindowChromeState } from '@shared/window-chrome'

function windowFrom(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function readChromeState(win: BrowserWindow): WindowChromeState {
  return {
    focused: win.isFocused(),
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen(),
  }
}

function sendChromeState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send('window:state', readChromeState(win))
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 480,
    minHeight: 360,
    // Native traffic lights. `frame: false` hides them; HTML stand-ins under a
    // drag region do not receive clicks.
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 20 },
        }
      : { frame: false }),
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'followWindow',
    backgroundMaterial: 'acrylic',
    roundedCorners: true,
    hasShadow: true,
    acceptFirstMouse: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const onChromeChange = () => sendChromeState(win)
  win.on('focus', onChromeChange)
  win.on('blur', onChromeChange)
  win.on('maximize', onChromeChange)
  win.on('unmaximize', onChromeChange)
  win.on('enter-full-screen', onChromeChange)
  win.on('leave-full-screen', onChromeChange)
  win.once('ready-to-show', () => {
    if (process.platform === 'darwin') {
      win.setWindowButtonVisibility(true)
      win.setWindowButtonPosition({ x: 16, y: 20 })
    }
    win.show()
  })

  // Dev: electron-vite serves the renderer from its dev server (with HMR).
  // Prod: load the built file from out/renderer.
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

ipcMain.handle('auth:set', (_e, providerID: string, key: string) => setAuth(providerID, key.trim()))
ipcMain.handle('auth:get', (_e, providerID: string) => getAuth(providerID))
ipcMain.handle('providers:list', () => listProviders())
ipcMain.handle('auth:test', async (_e, providerID: string) => {
  // verify key actually works
  try {
    await chat(providerID, 'models', 'ping')
    return true
  } catch {
    return false
  }
})

ipcMain.handle('window:minimize', (event) => {
  windowFrom(event)?.minimize()
})
ipcMain.handle('window:close', (event) => {
  windowFrom(event)?.close()
})
ipcMain.handle('window:zoom', (event) => {
  const win = windowFrom(event)
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.handle('window:toggleFullScreen', (event) => {
  const win = windowFrom(event)
  if (!win) return
  void win.setFullScreen(!win.isFullScreen())
})
ipcMain.handle('window:getState', (event): WindowChromeState => {
  const win = windowFrom(event)
  if (!win) return { focused: false, maximized: false, fullScreen: false }
  return readChromeState(win)
})

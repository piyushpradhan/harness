import { join } from 'node:path'

import { BrowserWindow, app } from 'electron'

import { createLogger } from '@shared/logger'

import { readChromeState, registerIpcHandlers } from './ipc'

const log = createLogger('main')

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

  const onChromeChange = (): void => sendChromeState(win)
  win.on('focus', onChromeChange)
  win.on('blur', onChromeChange)
  win.on('maximize', onChromeChange)
  win.on('unmaximize', onChromeChange)
  win.on('enter-full-screen', onChromeChange)
  win.on('leave-full-screen', onChromeChange)
  win.webContents.on('render-process-gone', (_event, details) => {
    log.error('renderer process gone', details)
  })

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
  log.info('app ready', {
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
  })
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  log.info('all windows closed, quitting')
  app.quit()
})

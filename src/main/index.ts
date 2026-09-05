import { join } from 'node:path'

import { BrowserWindow, app } from 'electron'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
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

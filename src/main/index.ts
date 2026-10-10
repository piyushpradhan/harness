import { join } from 'node:path'

import { BrowserWindow, app } from 'electron'

import { createLogger } from '@shared/logger'

import { readChromeState, registerIpcHandlers } from './ipc'
import { prewarm, stopServer } from './services/opencode'

const log = createLogger('main')

/** `stream` runs the streaming benchmark; any other value means cold-start. */
const BENCH_MODE = process.env.HARNESS_BENCH

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

  if (BENCH_MODE === 'stream') attachStreamBench(win)

  win.once('ready-to-show', () => {
    // ponytail: `ready-to-show` is the closest proxy for first paint that does
    // not need renderer instrumentation — the frame is composited and the
    // window is one `show()` away. scripts/bench.ts parses this line.
    if (BENCH_MODE && BENCH_MODE !== 'stream') {
      process.stdout.write(`harness:bench first-paint ${Date.now()}\n`)
      app.quit()
      return
    }

    if (process.platform === 'darwin') {
      win.setWindowButtonVisibility(true)
      win.setWindowButtonPosition({ x: 16, y: 20 })
    }
    win.show()
    // Boot OpenCode now so the first message finds it up. Not earlier: the
    // spawn is a whole Bun runtime starting, and measured alongside renderer
    // startup it cost cold-start up to ~80 ms p50. Nobody can type before the
    // window is shown, so starting here hides the same boot for free.
    prewarm()
  })

  // The streaming benchmark needs a window that actually composites frames, so
  // it renders normally and reports from the renderer instead.
  const search = BENCH_MODE === 'stream' ? '?bench=stream' : ''

  // Dev: electron-vite serves the renderer from its dev server (with HMR).
  // Prod: load the built file from out/renderer.
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${search}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
}

/**
 * Forward the renderer's `harness:bench` line to stdout, where scripts/bench.ts
 * reads it, and stamp it with the renderer's resident set size — which only the
 * main process can see, since the renderer is sandboxed and has no `process`.
 */
function attachStreamBench(win: BrowserWindow): void {
  win.webContents.on('console-message', (details) => {
    if (!details.message.startsWith('harness:bench stream ')) return
    const report = JSON.parse(details.message.slice('harness:bench stream '.length)) as Record<
      string,
      unknown
    >
    const pid = win.webContents.getOSProcessId()
    const metrics = app.getAppMetrics().find((entry) => entry.pid === pid)
    // `workingSetSize` is reported in kilobytes.
    report.rssMb = metrics ? metrics.memory.workingSetSize / 1024 : 0
    process.stdout.write(`harness:bench stream ${JSON.stringify(report)}\n`)
    app.quit()
  })
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

app.on('will-quit', () => {
  stopServer()
})

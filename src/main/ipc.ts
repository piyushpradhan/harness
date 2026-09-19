import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'

import { hasAuth, setAuth } from './services/auth'
import { testConnection } from './services/llm'
import { onStreamEvent, sendMessage } from './services/opencode'
import { listProviders } from './services/providers'

import { createLogger } from '@shared/logger'

import type { WindowChromeState } from '@shared/window-chrome'

const log = createLogger('ipc')

function windowFrom(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function readChromeState(win: BrowserWindow): WindowChromeState {
  return {
    focused: win.isFocused(),
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen(),
  }
}

/**
 * Every `invoke` channel in one place. Keys stay in main: the renderer can ask
 * whether a provider is connected, never what its key is.
 */
export function registerIpcHandlers(): void {
  log.debug('registering IPC handlers')

  ipcMain.handle('providers:list', () => listProviders())
  ipcMain.handle('auth:set', (_event, providerId: string, key: string) => setAuth(providerId, key))
  ipcMain.handle('auth:has', (_event, providerId: string) => hasAuth(providerId))
  ipcMain.handle('auth:test', (_event, providerId: string) => {
    log.info('testing provider connection', { provider: providerId })
    return testConnection(providerId)
  })

  // Streaming channel to OpenCode. The window that sent the message receives
  // the stream batches; the bus itself is global and filtered in the service.
  let streamTarget: BrowserWindow | null = null
  onStreamEvent((batch) => {
    if (streamTarget && !streamTarget.isDestroyed()) {
      streamTarget.webContents.send('opencode:stream', batch)
    }
  })
  ipcMain.handle('opencode:send', async (event, text: string) => {
    const win = windowFrom(event)
    if (win) streamTarget = win
    try {
      await sendMessage(String(text))
      return { ok: true }
    } catch (err) {
      log.error('opencode send failed', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
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
    win.setFullScreen(!win.isFullScreen())
  })
  ipcMain.handle('window:getState', (event): WindowChromeState => {
    const win = windowFrom(event)
    if (!win) return { focused: false, maximized: false, fullScreen: false }
    return readChromeState(win)
  })
}

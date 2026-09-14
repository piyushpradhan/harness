import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'

import { hasAuth, setAuth } from './services/auth'
import { testConnection } from './services/llm'
import { listProviders } from './services/providers'

import type { WindowChromeState } from '@shared/window-chrome'

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
  ipcMain.handle('providers:list', () => listProviders())
  ipcMain.handle('auth:set', (_event, providerId: string, key: string) => setAuth(providerId, key))
  ipcMain.handle('auth:has', (_event, providerId: string) => hasAuth(providerId))
  ipcMain.handle('auth:test', (_event, providerId: string) => testConnection(providerId))

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

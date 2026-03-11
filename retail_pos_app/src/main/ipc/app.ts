import { app, ipcMain, type BrowserWindow } from 'electron'
import os from 'node:os'

export function registerAppHandlers(getMainWindow: () => BrowserWindow | null, toggleCustomerDisplay: () => void): void {
  ipcMain.handle('app:restart', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('app:get-network-ip', () => {
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] ?? []) {
        if (!iface.internal && iface.family === 'IPv4') {
          return iface.address
        }
      }
    }
    return null
  })

  ipcMain.handle('app:toggle-fullscreen', () => {
    const win = getMainWindow()
    if (!win) return
    win.setFullScreen(!win.isFullScreen())
  })

  ipcMain.handle('app:toggle-customer-display', () => {
    toggleCustomerDisplay()
  })
}

import { ipcMain } from 'electron'
import os from 'node:os'

export function registerAppHandlers(): void {
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
}

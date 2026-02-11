import { ipcMain, BrowserWindow } from 'electron'
import { loadConfig } from '../store'
import { BaseScale, CasScale, DatalogicScale } from '../driver'

let activeScale: BaseScale | null = null
let getWindow: (() => BrowserWindow | null) | null = null

async function connectScale(): Promise<{ ok: boolean; message: string }> {
  const config = loadConfig()
  const scaleConfig = config.devices.scale

  if (!scaleConfig) {
    return { ok: false, message: 'No scale configured' }
  }

  if (activeScale?.isConnected) {
    await activeScale.disconnect()
  }

  if (scaleConfig.type === 'CAS') {
    activeScale = new CasScale(scaleConfig)
  } else {
    const driver = new DatalogicScale(scaleConfig)
    driver.setBarcodeHandler((barcode) => {
      const win = getWindow?.()
      if (win && !win.isDestroyed()) {
        win.webContents.send('barcode:scan', barcode)
      }
    })
    activeScale = driver
  }

  const connected = await activeScale.connect()
  return { ok: connected, message: connected ? 'Connected' : 'Failed to connect' }
}

export function registerScaleHandlers(getMainWindow: () => BrowserWindow | null): void {
  getWindow = getMainWindow

  ipcMain.handle('scale:connect', connectScale)

  ipcMain.handle('scale:disconnect', async () => {
    if (activeScale) {
      await activeScale.disconnect()
      activeScale = null
    }
  })

  ipcMain.handle('scale:read-weight', async () => {
    if (!activeScale?.isConnected) {
      return { weight: 0, unit: 'kg', status: 'disconnected', message: 'Not connected' }
    }
    return activeScale.readWeight()
  })

  ipcMain.handle('scale:status', () => {
    return { connected: activeScale?.isConnected ?? false }
  })
}

export async function autoConnectScale(): Promise<void> {
  const config = loadConfig()
  if (config.devices.scale) {
    const result = await connectScale()
    console.log(`[Scale] Auto-connect: ${result.message}`)
  }
}

export function disconnectScale(): void {
  if (activeScale) {
    activeScale.disconnect()
    activeScale = null
  }
}

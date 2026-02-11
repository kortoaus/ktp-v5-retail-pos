import { ipcMain, BrowserWindow } from 'electron'
import { SerialPort } from 'serialport'

let activePort: SerialPort | null = null

export function registerSerialHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('serial:list-ports', async () => {
    const ports = await SerialPort.list()
    return ports.map((p) => p.path)
  })

  ipcMain.handle('serial:open', async (_event, path: string, baudRate: number) => {
    if (activePort?.isOpen) {
      activePort.close()
    }

    return new Promise<void>((resolve, reject) => {
      activePort = new SerialPort({ path, baudRate }, (err) => {
        if (err) {
          reject(err)
          return
        }
        resolve()
      })

      activePort.on('data', (data: Buffer) => {
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('serial:data', data.toString())
        }
      })
    })
  })

  ipcMain.handle('serial:close', async () => {
    if (activePort?.isOpen) {
      return new Promise<void>((resolve, reject) => {
        activePort!.close((err) => {
          if (err) reject(err)
          else resolve()
          activePort = null
        })
      })
    }
  })

  ipcMain.handle('serial:send', async (_event, data: string) => {
    if (!activePort?.isOpen) {
      throw new Error('Serial port is not open')
    }

    return new Promise<void>((resolve, reject) => {
      activePort!.write(data, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  })
}

export function closeActivePort(): void {
  if (activePort?.isOpen) {
    activePort.close()
    activePort = null
  }
}

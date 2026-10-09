import { ipcMain } from 'electron'
import { SerialPort } from 'serialport'

// Port discovery for the hardware setup screens. The generic open/close/send/data bridge had no renderer caller
// (R-21, T-26) and was removed; the scale, label and ESC/POS handlers own their own ports.
export function registerSerialHandlers(): void {
  ipcMain.handle('serial:list-ports', async () => {
    const ports = await SerialPort.list()
    return ports.map((p) => p.path)
  })
}

import { ipcMain } from 'electron'
import { SerialPort } from 'serialport'
import type { EscposPrintRequest } from '../types'

const MIN_SERIAL_TIMEOUT_MS = 5000
const SERIAL_TIMEOUT_MARGIN_MS = 10000
const BITS_PER_BYTE_ON_WIRE = 10

function getSerialTimeoutMs(bytes: number, baudRate: number): number {
  const bytesPerSecond = Math.max(1, baudRate / BITS_PER_BYTE_ON_WIRE)
  const estimatedMs = Math.ceil((bytes / bytesPerSecond) * 1000)
  return Math.max(MIN_SERIAL_TIMEOUT_MS, estimatedMs + SERIAL_TIMEOUT_MARGIN_MS)
}

function closePort(port: SerialPort): void {
  if (!port.isOpen) return
  try {
    port.close()
  } catch {}
}

function closePortBeforeReject(
  port: SerialPort,
  reject: (reason?: unknown) => void,
  timeout: NodeJS.Timeout,
  originalError: Error | null,
  closeErrorPrefix: string,
): void {
  const rejectWithOriginalOrClose = (closeErr?: Error | null): void => {
    clearTimeout(timeout)
    if (originalError) {
      reject(originalError)
      return
    }
    if (closeErr) {
      reject(new Error(`${closeErrorPrefix}: ${closeErr.message}`))
      return
    }
    reject(new Error('Unknown ESC/POS error'))
  }

  if (!port.isOpen) {
    rejectWithOriginalOrClose(null)
    return
  }

  try {
    port.close(rejectWithOriginalOrClose)
  } catch (err) {
    rejectWithOriginalOrClose(err instanceof Error ? err : null)
  }
}

function printEscposSerial(request: EscposPrintRequest): Promise<void> {
  const data = Buffer.from(request.data)
  const timeoutMs = getSerialTimeoutMs(data.length, request.printer.baudRate)

  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: request.printer.path,
      baudRate: request.printer.baudRate,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false,
    })

    const timeout = setTimeout(() => {
      closePort(port)
      reject(
        new Error(
          `ESC/POS serial timeout on ${request.printer.path} after ${timeoutMs}ms`,
        ),
      )
    }, timeoutMs)

    port.open((openErr) => {
      if (openErr) {
        clearTimeout(timeout)
        reject(new Error(`ESC/POS serial open failed: ${openErr.message}`))
        return
      }

      port.write(data, (writeErr) => {
        if (writeErr) {
          closePortBeforeReject(
            port,
            reject,
            timeout,
            new Error(`ESC/POS serial write failed: ${writeErr.message}`),
            'ESC/POS serial close failed',
          )
          return
        }

        port.drain((drainErr) => {
          if (drainErr) {
            closePortBeforeReject(
              port,
              reject,
              timeout,
              new Error(`ESC/POS serial drain failed: ${drainErr.message}`),
              'ESC/POS serial close failed',
            )
            return
          }

          port.close((closeErr) => {
            clearTimeout(timeout)
            if (closeErr) {
              reject(new Error(`ESC/POS serial close failed: ${closeErr.message}`))
              return
            }
            resolve()
          })
        })
      })
    })
  })
}

export function registerEscposHandlers(): void {
  ipcMain.handle('escpos:print', async (_event, request: EscposPrintRequest) => {
    try {
      await printEscposSerial(request)
      return { ok: true, message: 'Printed' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown ESC/POS error'
      return { ok: false, message }
    }
  })
}

import { ipcMain } from 'electron'
import { SerialPort } from 'serialport'
import type { EscposPrintRequest } from '../types'

const MIN_SERIAL_TIMEOUT_MS = 5000
const SERIAL_CLOSE_TIMEOUT_MS = 5000
const SERIAL_TIMEOUT_MARGIN_MS = 10000
const BITS_PER_BYTE_ON_WIRE = 10
const LOG_PREFIX = '[ESC/POS:Serial]'

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

function printEscposSerial(request: EscposPrintRequest): Promise<void> {
  const data = Buffer.from(request.data)
  const timeoutMs = getSerialTimeoutMs(data.length, request.printer.baudRate)
  const jobLabel = `${request.printer.path} @ ${request.printer.baudRate}`

  console.log(
    `${LOG_PREFIX} Job start: ${jobLabel}, bytes=${data.length}, timeout=${timeoutMs}ms`,
  )

  return new Promise((resolve, reject) => {
    let settled = false
    let closingForError = false
    let closeTimeout: NodeJS.Timeout | null = null

    const port = new SerialPort({
      path: request.printer.path,
      baudRate: request.printer.baudRate,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false,
    })

    function finish(): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (closeTimeout) clearTimeout(closeTimeout)
      console.log(`${LOG_PREFIX} Job done: ${jobLabel}`)
      resolve()
    }

    function fail(error: Error): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (closeTimeout) clearTimeout(closeTimeout)
      console.log(`${LOG_PREFIX} Job failed: ${jobLabel}: ${error.message}`)
      reject(error)
    }

    function failAndClose(error: Error): void {
      if (settled) return

      if (!port.isOpen) {
        fail(error)
        return
      }

      closingForError = true
      try {
        port.close(() => {
          if (settled) return
          closingForError = false
          fail(error)
        })
      } catch {
        closingForError = false
        fail(error)
      }
    }

    const timeout = setTimeout(() => {
      if (settled) return
      console.log(`${LOG_PREFIX} Timeout: ${jobLabel}, closing port`)
      closePort(port)
      fail(
        new Error(
          `ESC/POS serial timeout on ${request.printer.path} after ${timeoutMs}ms`,
        ),
      )
    }, timeoutMs)

    console.log(`${LOG_PREFIX} Opening port: ${jobLabel}`)
    port.open((openErr) => {
      if (settled) {
        console.log(`${LOG_PREFIX} Open callback after settlement: ${jobLabel}`)
        closePort(port)
        return
      }
      if (closingForError) return
      if (openErr) {
        console.log(`${LOG_PREFIX} Open failed: ${jobLabel}: ${openErr.message}`)
        fail(new Error(`ESC/POS serial open failed: ${openErr.message}`))
        return
      }

      console.log(`${LOG_PREFIX} Port opened: ${jobLabel}`)
      console.log(`${LOG_PREFIX} Writing bytes: ${jobLabel}, bytes=${data.length}`)
      port.write(data, (writeErr) => {
        if (settled || closingForError) return
        if (writeErr) {
          console.log(`${LOG_PREFIX} Write failed: ${jobLabel}: ${writeErr.message}`)
          failAndClose(new Error(`ESC/POS serial write failed: ${writeErr.message}`))
          return
        }

        console.log(`${LOG_PREFIX} Write callback ok: ${jobLabel}`)
        console.log(`${LOG_PREFIX} Draining port: ${jobLabel}`)
        port.drain((drainErr) => {
          if (settled || closingForError) return
          if (drainErr) {
            console.log(`${LOG_PREFIX} Drain failed: ${jobLabel}: ${drainErr.message}`)
            failAndClose(new Error(`ESC/POS serial drain failed: ${drainErr.message}`))
            return
          }

          console.log(`${LOG_PREFIX} Drain complete: ${jobLabel}`)
          clearTimeout(timeout)
          closeTimeout = setTimeout(() => {
            console.log(`${LOG_PREFIX} Close timeout: ${jobLabel}`)
            fail(
              new Error(
                `ESC/POS serial close timeout on ${request.printer.path} after ${SERIAL_CLOSE_TIMEOUT_MS}ms`,
              ),
            )
          }, SERIAL_CLOSE_TIMEOUT_MS)

          try {
            console.log(`${LOG_PREFIX} Closing port: ${jobLabel}`)
            port.close((closeErr) => {
              if (settled) return
              if (closeErr) {
                console.log(`${LOG_PREFIX} Close failed: ${jobLabel}: ${closeErr.message}`)
                fail(new Error(`ESC/POS serial close failed: ${closeErr.message}`))
                return
              }
              console.log(`${LOG_PREFIX} Port closed: ${jobLabel}`)
              finish()
            })
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown close error'
            console.log(`${LOG_PREFIX} Close threw: ${jobLabel}: ${message}`)
            fail(new Error(`ESC/POS serial close failed: ${message}`))
          }
        })
      })
    })
  })
}

export function registerEscposHandlers(): void {
  ipcMain.handle('escpos:print', async (_event, request: EscposPrintRequest) => {
    try {
      console.log(
        `${LOG_PREFIX} IPC request: path=${request.printer.path}, baudRate=${request.printer.baudRate}, bytes=${request.data.length}`,
      )
      await printEscposSerial(request)
      return { ok: true, message: 'Printed' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown ESC/POS error'
      console.log(`${LOG_PREFIX} IPC response failed: ${message}`)
      return { ok: false, message }
    }
  })
}

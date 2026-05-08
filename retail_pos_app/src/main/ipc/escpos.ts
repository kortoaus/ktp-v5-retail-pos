import { ipcMain } from 'electron'
import { SerialPort } from 'serialport'
import type {
  EscposControlLineMatrixEntry,
  EscposControlLineMatrixRequest,
  EscposControlLineMatrixResult,
  EscposModemStatus,
  EscposPrintRequest,
} from '../types'

const MIN_SERIAL_TIMEOUT_MS = 5000
const SERIAL_CLOSE_TIMEOUT_MS = 5000
const SERIAL_TIMEOUT_MARGIN_MS = 10000
const BITS_PER_BYTE_ON_WIRE = 10
const LOG_PREFIX = '[ESC/POS:Serial]'
const CONTROL_LINE_SETTLE_MS = 250
const ESC = 0x1b
const ESC_INIT = 0x40
const INIT_SETTLE_MS = 750

const CONTROL_LINE_MATRIX = [
  { label: 'DTR=true RTS=false', dtr: true, rts: false },
  { label: 'DTR=false RTS=true', dtr: false, rts: true },
  { label: 'DTR=true RTS=true', dtr: true, rts: true },
] as const

function getSerialTimeoutMs(bytes: number, baudRate: number): number {
  const bytesPerSecond = Math.max(1, baudRate / BITS_PER_BYTE_ON_WIRE)
  const estimatedMs = Math.ceil((bytes / bytesPerSecond) * 1000)
  return Math.max(MIN_SERIAL_TIMEOUT_MS, estimatedMs + SERIAL_TIMEOUT_MARGIN_MS)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function closePort(port: SerialPort): void {
  if (!port.isOpen) return
  try {
    port.close()
  } catch {}
}

function createEscposSerialPort(printer: EscposPrintRequest['printer']): SerialPort {
  return new SerialPort({
    path: printer.path,
    baudRate: printer.baudRate,
    dataBits: printer.dataBits,
    parity: printer.parity,
    stopBits: printer.stopBits,
    rtscts: printer.handshaking === 'rts-cts',
    xon: printer.handshaking === 'xon-xoff',
    xoff: printer.handshaking === 'xon-xoff',
    autoOpen: false,
  })
}

function closePortAsync(port: SerialPort): Promise<void> {
  if (!port.isOpen) return Promise.resolve()

  return new Promise((resolve, reject) => {
    port.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function openPort(port: SerialPort): Promise<void> {
  return new Promise((resolve, reject) => {
    port.open((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function setControlLines(
  port: SerialPort,
  lines: { dtr: boolean; rts: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    port.set(lines, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function setConfiguredControlLines(
  port: SerialPort,
  printer: EscposPrintRequest['printer'],
): Promise<void> {
  if (printer.handshaking === 'rts-cts') {
    return setControlLines(port, { dtr: printer.dtr, rts: true })
  }

  return setControlLines(port, { dtr: printer.dtr, rts: printer.rts })
}

function getModemStatus(port: SerialPort): Promise<EscposModemStatus> {
  return new Promise((resolve, reject) => {
    port.get((err, status) => {
      if (err) {
        reject(err)
        return
      }
      if (!status) {
        reject(new Error('Serial modem status unavailable'))
        return
      }

      resolve({
        cts: status.cts,
        dsr: status.dsr,
        dcd: status.dcd,
      })
    })
  })
}

function writeAndDrain(port: SerialPort, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    port.write(data, (writeErr) => {
      if (writeErr) {
        reject(writeErr)
        return
      }

      port.drain((drainErr) => {
        if (drainErr) reject(drainErr)
        else resolve()
      })
    })
  })
}

async function writeEscposPayload(port: SerialPort, data: Buffer): Promise<void> {
  if (data.length >= 2 && data[0] === ESC && data[1] === ESC_INIT) {
    await writeAndDrain(port, data.subarray(0, 2))
    await delay(INIT_SETTLE_MS)
    if (data.length === 2) return
    await writeAndDrain(port, data.subarray(2))
    return
  }

  await writeAndDrain(port, data)
}

async function testEscposControlLineMatrix(
  request: EscposControlLineMatrixRequest,
): Promise<EscposControlLineMatrixResult> {
  const data = Buffer.from(request.data)
  const timeoutMs = getSerialTimeoutMs(
    data.length * CONTROL_LINE_MATRIX.length,
    request.printer.baudRate,
  )
  const jobLabel = `${request.printer.path} @ ${request.printer.baudRate}`
  const entries: EscposControlLineMatrixEntry[] = []

  console.log(
    `${LOG_PREFIX} Control matrix start: ${jobLabel}, cases=${CONTROL_LINE_MATRIX.length}, bytesPerCase=${data.length}, timeout=${timeoutMs}ms`,
  )
  console.log(
    `${LOG_PREFIX} Control matrix serial settings: ${jobLabel}, dataBits=${request.printer.dataBits}, parity=${request.printer.parity}, stopBits=${request.printer.stopBits}, handshaking=${request.printer.handshaking}, configuredDtr=${request.printer.dtr}, configuredRts=${request.printer.rts}`,
  )

  const port = createEscposSerialPort(request.printer)

  let timeout: NodeJS.Timeout | null = null
  try {
    await Promise.race([
      (async () => {
        console.log(`${LOG_PREFIX} Control matrix opening port: ${jobLabel}`)
        await openPort(port)
        console.log(`${LOG_PREFIX} Control matrix port opened: ${jobLabel}`)

        for (const controls of CONTROL_LINE_MATRIX) {
          let status: EscposModemStatus | null = null
          console.log(
            `${LOG_PREFIX} Control matrix setting: ${jobLabel}, ${controls.label}`,
          )
          await setControlLines(port, { dtr: controls.dtr, rts: controls.rts })
          await delay(CONTROL_LINE_SETTLE_MS)

          try {
            status = await getModemStatus(port)
            console.log(
              `${LOG_PREFIX} Control matrix status: ${jobLabel}, ${controls.label}, cts=${status.cts}, dsr=${status.dsr}, dcd=${status.dcd}`,
            )
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown modem status error'
            console.log(
              `${LOG_PREFIX} Control matrix status failed: ${jobLabel}, ${controls.label}: ${message}`,
            )
          }

          try {
            console.log(
              `${LOG_PREFIX} Control matrix writing: ${jobLabel}, ${controls.label}, bytes=${data.length}`,
            )
            await writeAndDrain(port, data)
            entries.push({
              ...controls,
              status,
              ok: true,
              message: 'Wrote and drained',
            })
            console.log(
              `${LOG_PREFIX} Control matrix write ok: ${jobLabel}, ${controls.label}`,
            )
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown write error'
            entries.push({
              ...controls,
              status,
              ok: false,
              message,
            })
            console.log(
              `${LOG_PREFIX} Control matrix write failed: ${jobLabel}, ${controls.label}: ${message}`,
            )
          }
        }
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `ESC/POS serial control matrix timeout on ${request.printer.path} after ${timeoutMs}ms`,
            ),
          )
        }, timeoutMs)
      }),
    ])

    return {
      ok: entries.every((entry) => entry.ok),
      message: 'Control-line matrix complete',
      entries,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown control matrix error'
    console.log(`${LOG_PREFIX} Control matrix failed: ${jobLabel}: ${message}`)
    return {
      ok: false,
      message,
      entries,
    }
  } finally {
    if (timeout) clearTimeout(timeout)
    if (port.isOpen) {
      console.log(`${LOG_PREFIX} Control matrix closing port: ${jobLabel}`)
      try {
        await closePortAsync(port)
        console.log(`${LOG_PREFIX} Control matrix port closed: ${jobLabel}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown close error'
        console.log(`${LOG_PREFIX} Control matrix close failed: ${jobLabel}: ${message}`)
      }
    }
  }
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

    const port = createEscposSerialPort(request.printer)

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
      console.log(
        `${LOG_PREFIX} Serial settings: ${jobLabel}, dataBits=${request.printer.dataBits}, parity=${request.printer.parity}, stopBits=${request.printer.stopBits}, handshaking=${request.printer.handshaking}, dtr=${request.printer.dtr}, rts=${request.printer.rts}`,
      )
      console.log(`${LOG_PREFIX} Setting configured DTR/RTS: ${jobLabel}`)
      setConfiguredControlLines(port, request.printer).then(async () => {
        if (settled || closingForError) return

        await delay(CONTROL_LINE_SETTLE_MS)
        if (settled || closingForError) return

        port.get((getErr, status) => {
          if (getErr) {
            console.log(`${LOG_PREFIX} Modem status read failed: ${jobLabel}: ${getErr.message}`)
          } else if (!status) {
            console.log(`${LOG_PREFIX} Modem status read failed: ${jobLabel}: unavailable`)
          } else {
            console.log(
              `${LOG_PREFIX} Modem status: ${jobLabel}, cts=${status.cts}, dsr=${status.dsr}, dcd=${status.dcd}`,
            )
          }

          console.log(`${LOG_PREFIX} Writing bytes: ${jobLabel}, bytes=${data.length}`)
          writeEscposPayload(port, data).then(() => {
              if (settled || closingForError) return

              console.log(`${LOG_PREFIX} Write and drain complete: ${jobLabel}`)
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
          }).catch((writeErr) => {
            if (settled || closingForError) return
            const message = writeErr instanceof Error ? writeErr.message : 'Unknown write error'
            console.log(`${LOG_PREFIX} Write failed: ${jobLabel}: ${message}`)
            failAndClose(new Error(`ESC/POS serial write failed: ${message}`))
          })
        })
      }).catch((setErr) => {
        if (settled || closingForError) return
        const message = setErr instanceof Error ? setErr.message : 'Unknown DTR/RTS error'
        console.log(`${LOG_PREFIX} Set configured DTR/RTS failed: ${jobLabel}: ${message}`)
        failAndClose(new Error(`ESC/POS serial DTR/RTS failed: ${message}`))
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

  ipcMain.handle(
    'escpos:test-control-lines',
    async (_event, request: EscposControlLineMatrixRequest) => {
      try {
        console.log(
          `${LOG_PREFIX} Control matrix IPC request: path=${request.printer.path}, baudRate=${request.printer.baudRate}, bytes=${request.data.length}`,
        )
        return await testEscposControlLineMatrix(request)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown ESC/POS control matrix error'
        console.log(`${LOG_PREFIX} Control matrix IPC response failed: ${message}`)
        return { ok: false, message, entries: [] }
      }
    },
  )
}

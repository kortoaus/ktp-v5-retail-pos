import { ipcMain } from 'electron'
import { SerialPort } from 'serialport'
import { loadConfig } from '../store'
import type {
  EscposControlLineMatrixEntry,
  EscposControlLineMatrixRequest,
  EscposControlLineMatrixResult,
  EscposModemStatus,
  EscposPrintRequest,
} from '../types'

const MIN_SERIAL_TIMEOUT_MS = 5000
const SERIAL_TIMEOUT_MARGIN_MS = 10000
const BITS_PER_BYTE_ON_WIRE = 10
const LOG_PREFIX = '[ESC/POS:Serial]'
const CONTROL_LINE_SETTLE_MS = 250
const ESC = 0x1b
const ESC_INIT = 0x40
const INIT_SETTLE_MS = 1500
const SERIAL_BODY_GUARD_BYTES = 256
const SERIAL_BODY_GUARD_SETTLE_MS = 250

const CONTROL_LINE_MATRIX = [
  { label: 'DTR=true RTS=false', dtr: true, rts: false },
  { label: 'DTR=false RTS=true', dtr: false, rts: true },
  { label: 'DTR=true RTS=true', dtr: true, rts: true },
] as const

let activeEscposPort: SerialPort | null = null
let activeEscposPrinterKey: string | null = null
let serialPrintQueue: Promise<void> = Promise.resolve()

function getSerialTimeoutMs(bytes: number, baudRate: number): number {
  const bytesPerSecond = Math.max(1, baudRate / BITS_PER_BYTE_ON_WIRE)
  const estimatedMs = Math.ceil((bytes / bytesPerSecond) * 1000)
  return Math.max(MIN_SERIAL_TIMEOUT_MS, estimatedMs + SERIAL_TIMEOUT_MARGIN_MS)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function getEscposPrinterKey(printer: EscposPrintRequest['printer']): string {
  return [
    printer.path,
    printer.baudRate,
    printer.dataBits,
    printer.parity,
    printer.stopBits,
    printer.handshaking,
    printer.dtr,
    printer.rts,
  ].join('|')
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

function hexPreview(data: Buffer, length = 16): string {
  return data
    .subarray(0, length)
    .toString('hex')
    .match(/.{1,2}/g)
    ?.join(' ') ?? ''
}

async function writeEscposPayload(port: SerialPort, data: Buffer): Promise<void> {
  if (data.length >= 2 && data[0] === ESC && data[1] === ESC_INIT) {
    console.log(
      `${LOG_PREFIX} Payload starts with ESC @, splitting init/body: bytes=${data.length}, first16=${hexPreview(data)}`,
    )
    await writeAndDrain(port, data.subarray(0, 2))
    console.log(`${LOG_PREFIX} Init write drained, settling ${INIT_SETTLE_MS}ms`)
    await delay(INIT_SETTLE_MS)
    if (data.length === 2) return

    const guard = Buffer.alloc(SERIAL_BODY_GUARD_BYTES, 0)
    console.log(
      `${LOG_PREFIX} Writing serial body guard: bytes=${guard.length}, settle=${SERIAL_BODY_GUARD_SETTLE_MS}ms`,
    )
    await writeAndDrain(port, guard)
    await delay(SERIAL_BODY_GUARD_SETTLE_MS)

    console.log(
      `${LOG_PREFIX} Writing serial body: bytes=${data.length - 2}, first16=${hexPreview(data.subarray(2))}`,
    )
    await writeAndDrain(port, data.subarray(2))
    return
  }

  console.log(
    `${LOG_PREFIX} Writing payload without leading ESC @: bytes=${data.length}, first16=${hexPreview(data)}`,
  )
  await writeAndDrain(port, data)
}

async function connectEscposSerialPrinter(
  printer: EscposPrintRequest['printer'],
): Promise<SerialPort> {
  const key = getEscposPrinterKey(printer)
  const jobLabel = `${printer.path} @ ${printer.baudRate}`

  if (activeEscposPort?.isOpen && activeEscposPrinterKey === key) {
    return activeEscposPort
  }

  if (activeEscposPort) {
    console.log(`${LOG_PREFIX} Reconnecting persistent port: ${jobLabel}`)
    await disconnectEscposSerialPrinter()
  }

  const port = createEscposSerialPort(printer)
  console.log(`${LOG_PREFIX} Opening persistent port: ${jobLabel}`)
  await openPort(port)
  console.log(`${LOG_PREFIX} Persistent port opened: ${jobLabel}`)
  console.log(
    `${LOG_PREFIX} Serial settings: ${jobLabel}, dataBits=${printer.dataBits}, parity=${printer.parity}, stopBits=${printer.stopBits}, handshaking=${printer.handshaking}, dtr=${printer.dtr}, rts=${printer.rts}`,
  )

  port.on('error', (err) => {
    console.log(`${LOG_PREFIX} Persistent port error: ${jobLabel}: ${err.message}`)
    if (activeEscposPort === port) {
      activeEscposPort = null
      activeEscposPrinterKey = null
    }
  })

  port.on('close', () => {
    console.log(`${LOG_PREFIX} Persistent port closed: ${jobLabel}`)
    if (activeEscposPort === port) {
      activeEscposPort = null
      activeEscposPrinterKey = null
    }
  })

  console.log(`${LOG_PREFIX} Setting configured DTR/RTS: ${jobLabel}`)
  await setConfiguredControlLines(port, printer)
  await delay(CONTROL_LINE_SETTLE_MS)

  try {
    const status = await getModemStatus(port)
    console.log(
      `${LOG_PREFIX} Modem status: ${jobLabel}, cts=${status.cts}, dsr=${status.dsr}, dcd=${status.dcd}`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown modem status error'
    console.log(`${LOG_PREFIX} Modem status read failed: ${jobLabel}: ${message}`)
  }

  activeEscposPort = port
  activeEscposPrinterKey = key
  return port
}

export async function autoConnectEscposPrinter(): Promise<void> {
  const config = loadConfig()
  const printer = config.devices.escposPrinter
  if (!printer || printer.type !== 'serial') return

  const connectJob = serialPrintQueue.then(async () => {
    await connectEscposSerialPrinter(printer)
    console.log(`${LOG_PREFIX} Auto-connect: Connected`)
  })
  serialPrintQueue = connectJob.catch(() => {})

  try {
    await connectJob
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown auto-connect error'
    console.log(`${LOG_PREFIX} Auto-connect failed: ${message}`)
  }
}

export function disconnectEscposSerialPrinter(): Promise<void> {
  const port = activeEscposPort
  activeEscposPort = null
  activeEscposPrinterKey = null

  if (!port?.isOpen) return Promise.resolve()

  const path = port.path
  console.log(`${LOG_PREFIX} Closing persistent port: ${path}`)
  return closePortAsync(port).catch((err) => {
    const message = err instanceof Error ? err.message : 'Unknown close error'
    console.log(`${LOG_PREFIX} Persistent port close failed: ${path}: ${message}`)
  })
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

  await disconnectEscposSerialPrinter()
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

async function printEscposSerialNow(request: EscposPrintRequest): Promise<void> {
  const data = Buffer.from(request.data)
  const timeoutMs = getSerialTimeoutMs(data.length, request.printer.baudRate)
  const jobLabel = `${request.printer.path} @ ${request.printer.baudRate}`

  console.log(
    `${LOG_PREFIX} Job start: ${jobLabel}, bytes=${data.length}, timeout=${timeoutMs}ms`,
  )

  let timeout: NodeJS.Timeout | null = null
  try {
    await Promise.race([
      (async () => {
        const port = await connectEscposSerialPrinter(request.printer)
        console.log(`${LOG_PREFIX} Writing bytes: ${jobLabel}, bytes=${data.length}`)
        await writeEscposPayload(port, data)
        console.log(`${LOG_PREFIX} Write and drain complete: ${jobLabel}`)
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `ESC/POS serial timeout on ${request.printer.path} after ${timeoutMs}ms`,
            ),
          )
        }, timeoutMs)
      }),
    ])

    console.log(`${LOG_PREFIX} Job done: ${jobLabel}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown serial print error'
    console.log(`${LOG_PREFIX} Job failed: ${jobLabel}: ${message}`)
    await disconnectEscposSerialPrinter()
    throw err
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function printEscposSerial(request: EscposPrintRequest): Promise<void> {
  const printJob = serialPrintQueue.then(() => printEscposSerialNow(request))
  serialPrintQueue = printJob.catch(() => {})
  return printJob
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

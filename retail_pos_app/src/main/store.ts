import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type {
  AppConfig,
  EscposPrinterConfig,
  EscposSerialHandshaking,
  EscposSerialParity,
  EscposSerialSettings,
  ReceiptPrintMode,
  ReceiptTextEncoding,
  ZplSerialConfig,
} from './types'

const DEFAULT_CONFIG: AppConfig = {
  server: null,
  devices: {
    scale: null,
    zplSerial: [],
    zplNet: [],
    escposPrinter: null,
    receiptPrintMode: 'raster',
    receiptTextEncoding: 'ascii-replace',
  }
}

const ESCPOS_SERIAL_DEFAULTS: EscposSerialSettings = {
  baudRate: 38400,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  handshaking: 'dtr-dsr',
  dtr: true,
  rts: true,
}

const ESCPOS_PARITIES: EscposSerialParity[] = ['none', 'even', 'odd', 'mark', 'space']
const ESCPOS_HANDSHAKING: EscposSerialHandshaking[] = [
  'none',
  'dtr-dsr',
  'rts-cts',
  'xon-xoff',
]
const RECEIPT_PRINT_MODES: ReceiptPrintMode[] = ['raster', 'escpos']
const RECEIPT_TEXT_ENCODINGS: ReceiptTextEncoding[] = [
  'ascii-replace',
  'cp949',
  'euc-kr',
]

/** Backwards compat: old config stored zplSerial as a single object or null */
function migrateZplSerial(raw: unknown): ZplSerialConfig[] {
  if (Array.isArray(raw)) return raw as ZplSerialConfig[]
  if (raw && typeof raw === 'object' && 'path' in raw) {
    const old = raw as { path: string; language: 'zpl' | 'slcs'; name?: string }
    return [{ name: old.name ?? 'Serial', path: old.path, language: old.language }]
  }
  return []
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parsePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function parseEscposDataBits(value: unknown): 7 | 8 {
  return value === 7 || value === 8 ? value : ESCPOS_SERIAL_DEFAULTS.dataBits
}

function parseEscposStopBits(value: unknown): 1 | 2 {
  return value === 1 || value === 2 ? value : ESCPOS_SERIAL_DEFAULTS.stopBits
}

function parseEscposParity(value: unknown): EscposSerialParity {
  return typeof value === 'string' && ESCPOS_PARITIES.includes(value as EscposSerialParity)
    ? (value as EscposSerialParity)
    : ESCPOS_SERIAL_DEFAULTS.parity
}

function parseEscposHandshaking(value: unknown): EscposSerialHandshaking {
  return typeof value === 'string' &&
    ESCPOS_HANDSHAKING.includes(value as EscposSerialHandshaking)
    ? (value as EscposSerialHandshaking)
    : ESCPOS_SERIAL_DEFAULTS.handshaking
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parseReceiptPrintMode(value: unknown): ReceiptPrintMode {
  return typeof value === 'string' &&
    RECEIPT_PRINT_MODES.includes(value as ReceiptPrintMode)
    ? (value as ReceiptPrintMode)
    : DEFAULT_CONFIG.devices.receiptPrintMode
}

function parseReceiptTextEncoding(value: unknown): ReceiptTextEncoding {
  return typeof value === 'string' &&
    RECEIPT_TEXT_ENCODINGS.includes(value as ReceiptTextEncoding)
    ? (value as ReceiptTextEncoding)
    : DEFAULT_CONFIG.devices.receiptTextEncoding
}

function migrateEscposSerialSettings(printer: Record<string, unknown>): EscposSerialSettings {
  const baudRate = parsePositiveNumber(printer.baudRate) ?? ESCPOS_SERIAL_DEFAULTS.baudRate

  return {
    baudRate,
    dataBits: parseEscposDataBits(printer.dataBits),
    parity: parseEscposParity(printer.parity),
    stopBits: parseEscposStopBits(printer.stopBits),
    handshaking: parseEscposHandshaking(printer.handshaking),
    dtr: parseBoolean(printer.dtr, ESCPOS_SERIAL_DEFAULTS.dtr),
    rts: parseBoolean(printer.rts, ESCPOS_SERIAL_DEFAULTS.rts),
  }
}

function migrateEscposPrinter(raw: unknown): EscposPrinterConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const printer = raw as Record<string, unknown>

  if ('type' in printer) {
    if (printer.type === 'net') {
      const host = parseNonEmptyString(printer.host)
      const port = parsePositiveNumber(printer.port)
      if (!host || port === null) return null
      return {
        type: 'net',
        host,
        port,
      }
    }
    if (printer.type === 'serial') {
      const path = parseNonEmptyString(printer.path)
      if (!path) return null
      return {
        type: 'serial',
        path,
        ...migrateEscposSerialSettings(printer),
      }
    }
    return null
  }

  if ('host' in printer && 'port' in printer) {
    const host = parseNonEmptyString(printer.host)
    const port = parsePositiveNumber(printer.port)
    if (!host || port === null) return null
    return {
      type: 'net',
      host,
      port,
    }
  }

  return null
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'app-config.json')
}

export function loadConfig(): AppConfig {
  const filePath = getConfigPath()

  if (!fs.existsSync(filePath)) {
    return structuredClone(DEFAULT_CONFIG)
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return {
      server: parsed.server ?? null,
      devices: {
        scale: parsed.devices?.scale ?? null,
        zplSerial: migrateZplSerial(parsed.devices?.zplSerial),
        zplNet: parsed.devices?.zplNet ?? [],
        escposPrinter: migrateEscposPrinter(parsed.devices?.escposPrinter),
        receiptPrintMode: parseReceiptPrintMode(parsed.devices?.receiptPrintMode),
        receiptTextEncoding: parseReceiptTextEncoding(parsed.devices?.receiptTextEncoding),
      }
    }
  } catch {
    return structuredClone(DEFAULT_CONFIG)
  }
}

export function saveConfig(config: AppConfig): void {
  const filePath = getConfigPath()
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
}

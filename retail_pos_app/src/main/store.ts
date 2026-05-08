import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { AppConfig, EscposPrinterConfig, ZplSerialConfig } from './types'

const DEFAULT_CONFIG: AppConfig = {
  server: null,
  devices: {
    scale: null,
    zplSerial: [],
    zplNet: [],
    escposPrinter: null
  }
}

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
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null
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
      const baudRate = parsePositiveNumber(printer.baudRate)
      if (!path || baudRate === null) return null
      return {
        type: 'serial',
        path,
        baudRate,
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
        escposPrinter: migrateEscposPrinter(parsed.devices?.escposPrinter)
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

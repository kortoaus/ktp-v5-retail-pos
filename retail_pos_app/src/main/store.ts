import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { AppConfig } from './types'

const DEFAULT_CONFIG: AppConfig = {
  server: null,
  devices: {
    scale: null,
    zplSerial: null,
    zplNet: [],
    escposPrinter: null
  }
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
        zplSerial: parsed.devices?.zplSerial ?? null,
        zplNet: parsed.devices?.zplNet ?? [],
        escposPrinter: parsed.devices?.escposPrinter ?? null
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

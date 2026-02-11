import { ipcMain } from 'electron'
import { loadConfig, saveConfig } from '../store'
import type { AppConfig } from '../types'

export function registerConfigHandlers(): void {
  ipcMain.handle('config:get', () => {
    return loadConfig()
  })

  ipcMain.handle('config:set', (_event, config: AppConfig) => {
    saveConfig(config)
    return loadConfig()
  })
}

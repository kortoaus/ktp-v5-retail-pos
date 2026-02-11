import type { BrowserWindow } from 'electron'
import { registerAppHandlers } from './app'
import { registerConfigHandlers } from './config'
import { registerSerialHandlers, closeActivePort } from './serial'
import { registerScaleHandlers, autoConnectScale, disconnectScale } from './scale'
import { registerLabelHandlers } from './label'

export function registerAllHandlers(getMainWindow: () => BrowserWindow | null): void {
  registerAppHandlers()
  registerConfigHandlers()
  registerSerialHandlers(getMainWindow)
  registerScaleHandlers(getMainWindow)
  registerLabelHandlers()
}

export { autoConnectScale }

export function cleanupAll(): void {
  closeActivePort()
  disconnectScale()
}

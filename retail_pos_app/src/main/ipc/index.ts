import type { BrowserWindow } from 'electron'
import { registerAppHandlers } from './app'
import { registerConfigHandlers } from './config'
import { registerSerialHandlers, closeActivePort } from './serial'
import { registerScaleHandlers, autoConnectScale, disconnectScale } from './scale'
import { registerLabelHandlers } from './label'
import { registerEscposHandlers } from './escpos'
import { registerTextEncodingHandlers } from './text-encoding'

export function registerAllHandlers(
  getMainWindow: () => BrowserWindow | null,
  toggleCustomerDisplay: () => void,
): void {
  registerAppHandlers(getMainWindow, toggleCustomerDisplay)
  registerConfigHandlers()
  registerTextEncodingHandlers()
  registerSerialHandlers(getMainWindow)
  registerScaleHandlers(getMainWindow)
  registerLabelHandlers()
  registerEscposHandlers()
}

export { autoConnectScale }

export function cleanupAll(): void {
  closeActivePort()
  disconnectScale()
}

import type { BrowserWindow } from 'electron'
import { registerAppHandlers } from './app'
import { registerConfigHandlers } from './config'
import { registerSerialHandlers, closeActivePort } from './serial'
import { registerScaleHandlers, autoConnectScale, disconnectScale } from './scale'
import { registerLabelHandlers } from './label'
import {
  autoConnectEscposPrinter,
  disconnectEscposSerialPrinter,
  registerEscposHandlers,
} from './escpos'
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

export { autoConnectEscposPrinter, autoConnectScale }

export async function cleanupAll(): Promise<void> {
  closeActivePort()
  await Promise.all([
    disconnectScale(),
    disconnectEscposSerialPrinter(),
  ])
}

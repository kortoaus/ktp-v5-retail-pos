import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  EscposControlLineMatrixRequest,
  EscposControlLineMatrixResult,
  EscposPrintRequest,
  LabelSendRequest,
  TextEncodeRequest,
  WeightResult,
} from '../main/types'
import type {
  ZplFontInstallRequest,
  ZplFontProgressEvent,
  ZplFontTestPrintRequest,
} from '../main/ipc/zpl-font'
import type { PrinterTarget as ZplFontTarget } from '../main/zpl-font'

contextBridge.exposeInMainWorld('electronAPI', {
  getSerialPorts: (): Promise<string[]> => ipcRenderer.invoke('serial:list-ports'),

  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (config: AppConfig): Promise<AppConfig> =>
    ipcRenderer.invoke('config:set', config),
  encodeText: (request: TextEncodeRequest): Promise<number[]> =>
    ipcRenderer.invoke('text:encode', request),

  getNetworkIp: (): Promise<string | null> => ipcRenderer.invoke('app:get-network-ip'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  restartApp: (): Promise<void> => ipcRenderer.invoke('app:restart'),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke('app:toggle-fullscreen'),
  toggleCustomerDisplay: (): Promise<void> => ipcRenderer.invoke('app:toggle-customer-display'),

  scaleConnect: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('scale:connect'),
  scaleDisconnect: (): Promise<void> => ipcRenderer.invoke('scale:disconnect'),
  scaleReadWeight: (): Promise<WeightResult> => ipcRenderer.invoke('scale:read-weight'),
  scaleStatus: (): Promise<{ connected: boolean }> => ipcRenderer.invoke('scale:status'),
  onBarcodeScan: (callback: (barcode: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, barcode: string) => callback(barcode)
    ipcRenderer.on('barcode:scan', handler)
    return () => { ipcRenderer.removeListener('barcode:scan', handler) }
  },

  printLabel: (request: LabelSendRequest): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('label:print', request),

  printEscpos: (request: EscposPrintRequest): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('escpos:print', request),
  testEscposControlLines: (
    request: EscposControlLineMatrixRequest,
  ): Promise<EscposControlLineMatrixResult> =>
    ipcRenderer.invoke('escpos:test-control-lines', request),

  zplFontStatus: (target: ZplFontTarget, dpi?: number) =>
    ipcRenderer.invoke('zpl-font:status', target, dpi),
  zplFontInstall: (request: ZplFontInstallRequest) =>
    ipcRenderer.invoke('zpl-font:install', request),
  zplFontTestPrint: (request: ZplFontTestPrintRequest) =>
    ipcRenderer.invoke('zpl-font:test-print', request),
  onZplFontProgress: (callback: (event: ZplFontProgressEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ZplFontProgressEvent) =>
      callback(payload)
    ipcRenderer.on('zpl-font:progress', handler)
    return () => { ipcRenderer.removeListener('zpl-font:progress', handler) }
  },

  // T-24 (R-10) — main asks before installing a downloaded update; the
  // callback answers "is the till idle right now?".
  onUpdateCanInstall: (isIdle: () => boolean): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, requestId: number) => {
      let idle = false
      try {
        idle = isIdle() === true
      } catch {
        idle = false
      }
      ipcRenderer.send('update:can-install:reply', requestId, idle)
    }
    ipcRenderer.on('update:can-install', handler)
    return () => { ipcRenderer.removeListener('update:can-install', handler) }
  }
})

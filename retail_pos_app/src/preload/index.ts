import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, WeightResult, LabelSendRequest } from '../main/types'

contextBridge.exposeInMainWorld('electronAPI', {
  getSerialPorts: (): Promise<string[]> => ipcRenderer.invoke('serial:list-ports'),
  openSerialPort: (path: string, baudRate: number): Promise<void> =>
    ipcRenderer.invoke('serial:open', path, baudRate),
  closeSerialPort: (): Promise<void> => ipcRenderer.invoke('serial:close'),
  sendSerialData: (data: string): Promise<void> =>
    ipcRenderer.invoke('serial:send', data),
  onSerialData: (callback: (data: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data)
    ipcRenderer.on('serial:data', handler)
    return () => { ipcRenderer.removeListener('serial:data', handler) }
  },

  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (config: AppConfig): Promise<AppConfig> =>
    ipcRenderer.invoke('config:set', config),

  getNetworkIp: (): Promise<string | null> => ipcRenderer.invoke('app:get-network-ip'),
  restartApp: (): Promise<void> => ipcRenderer.invoke('app:restart'),

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
    ipcRenderer.invoke('label:print', request)
})

export interface ServerConfig {
  host: string
  port: number
}

export type ScaleType = 'CAS' | 'DATALOGIC'
export type Parity = 'none' | 'even' | 'odd' | 'mark' | 'space'

export interface ScaleConfig {
  type: ScaleType
  path: string
  baudRate: number
  dataBits: number
  stopBits: number
  parity: Parity
}

export type LabelLanguage = 'zpl' | 'slcs'

export interface ZplNetConfig {
  name: string
  host: string
  port: number
  language: LabelLanguage
}

export interface ZplSerialConfig {
  path: string
  language: LabelLanguage
}

export interface EscposPrinterConfig {
  host: string
  port: number
}

export interface DeviceConfig {
  scale: ScaleConfig | null
  zplSerial: ZplSerialConfig | null
  zplNet: ZplNetConfig[]
  escposPrinter: EscposPrinterConfig | null
}

export interface WeightResult {
  weight: number
  unit: 'kg' | 'lb' | 'oz' | 'g'
  status: 'stable' | 'unstable' | 'error' | 'disconnected'
  message?: string
}

export interface SLCSPart {
  type: 'raw' | 'euc-kr'
  data: string
}

export type LabelOutput =
  | { language: 'zpl'; data: string }
  | { language: 'slcs'; parts: SLCSPart[] }

export interface LabelSendRequest {
  printer: {
    type: 'serial' | 'net'
    path?: string
    host?: string
    port?: number
  }
  label: LabelOutput
}

export interface AppConfig {
  server: ServerConfig | null
  devices: DeviceConfig
}

export interface ElectronAPI {
  getSerialPorts: () => Promise<string[]>
  openSerialPort: (path: string, baudRate: number) => Promise<void>
  closeSerialPort: () => Promise<void>
  sendSerialData: (data: string) => Promise<void>
  onSerialData: (callback: (data: string) => void) => () => void

  getConfig: () => Promise<AppConfig>
  setConfig: (config: AppConfig) => Promise<AppConfig>

  getNetworkIp: () => Promise<string | null>

  scaleConnect: () => Promise<{ ok: boolean; message: string }>
  scaleDisconnect: () => Promise<void>
  scaleReadWeight: () => Promise<WeightResult>
  scaleStatus: () => Promise<{ connected: boolean }>
  onBarcodeScan: (callback: (barcode: string) => void) => () => void

  printLabel: (request: LabelSendRequest) => Promise<{ ok: boolean; message: string }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

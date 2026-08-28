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
/** Kept in step by hand with `label-core/media.ts MediaId` — preload cannot import it. */
export type MediaSize = '6040' | '58100' | '7030' | '7090' | '100100'
export type EscposSerialParity = 'none' | 'even' | 'odd' | 'mark' | 'space'
export type EscposSerialHandshaking = 'none' | 'dtr-dsr' | 'rts-cts' | 'xon-xoff'
export type ReceiptPrintMode = 'raster' | 'escpos'
export type ReceiptTextEncoding = 'ascii-replace' | 'cp949' | 'euc-kr'

export interface TextEncodeRequest {
  text: string
  encoding: ReceiptTextEncoding
}

export interface EscposSerialSettings {
  baudRate: number
  dataBits: 7 | 8
  parity: EscposSerialParity
  stopBits: 1 | 2
  handshaking: EscposSerialHandshaking
  dtr: boolean
  rts: boolean
}

export interface ZplNetConfig {
  name: string
  host: string
  port: number
  language: LabelLanguage
  mediaSize?: MediaSize
}

export interface ZplSerialConfig {
  name: string
  path: string
  language: LabelLanguage
  mediaSize?: MediaSize
}

export type EscposPrinterConfig =
  | {
      type: 'net'
      host: string
      port: number
    }
  | ({
      type: 'serial'
      path: string
    } & EscposSerialSettings)

export interface EscposPrintRequest {
  printer: Extract<EscposPrinterConfig, { type: 'serial' }>
  data: number[]
}

export interface EscposModemStatus {
  cts: boolean
  dsr: boolean
  dcd: boolean
}

export interface EscposControlLineMatrixEntry {
  label: string
  dtr: boolean
  rts: boolean
  status: EscposModemStatus | null
  ok: boolean
  message: string
}

export interface EscposControlLineMatrixRequest extends EscposPrintRequest {}

export interface EscposControlLineMatrixResult {
  ok: boolean
  message: string
  entries: EscposControlLineMatrixEntry[]
}

export interface DeviceConfig {
  scale: ScaleConfig | null
  zplSerial: ZplSerialConfig[]
  zplNet: ZplNetConfig[]
  escposPrinter: EscposPrinterConfig | null
  receiptPrintMode: ReceiptPrintMode
  receiptTextEncoding: ReceiptTextEncoding
}

export interface WeightResult {
  weight: number
  unit: 'kg' | 'lb' | 'oz' | 'g'
  status: 'stable' | 'unstable' | 'error' | 'disconnected'
  message?: string
}

/**
 * A label job. ZPL only — the legacy SLCS parts arm went with the legacy label
 * stack (2026-08-28). `LabelLanguage` above is unrelated and stays: it types
 * the printer *row* in `AppConfig`, which records how a printer was configured;
 * a row typed `slcs` receives ZPL like every other.
 */
export type LabelOutput = { language: 'zpl'; data: string }

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

// ── ZPL font install ────────────────────────────────────────────────────────
// Korean TrueType faces pushed into a network label printer's flash, so ZPL
// text fields can print hangul instead of being stripped to ASCII. Mirrors
// src/main/zpl-font; declared here because the renderer cannot import from
// src/main.

export interface ZplFontTarget {
  host: string
  port: number
}

export type ZplFontState =
  | 'installed'
  | 'missing'
  | 'mismatch'
  // A printer that answers no status query: 'unknown' before an install,
  // 'unverified' after one. Bixolon XD3/XD5 in BPL-Z is the whole reason.
  | 'unknown'
  | 'unverified'

export interface ZplFontStatusEntry {
  weight: string
  sourceFile: string
  objectName: string
  filename: string
  bundledSize: number
  installedSize: number | null
  state: ZplFontState
}

export interface ZplFontPrinterIdentity {
  model: string
  firmware: string
  dpmm: number
  dpi: number
}

export interface ZplFontCapabilities {
  /** False for a printer that never answers ~HI / ^HW — work blind. */
  responds: boolean
  model?: string
  dpi?: number
}

export interface ZplFontStatus {
  identity: ZplFontPrinterIdentity | null
  capabilities: ZplFontCapabilities
  fonts: ZplFontStatusEntry[]
  installedCount: number
  totalCount: number
  freeBytes: number | null
  message?: string
}

export interface ZplFontInstallProgress {
  index: number
  count: number
  weight: string
  filename: string
  sentBytes: number
  totalBytes: number
}

export interface ZplFontProgressEvent {
  target: { host: string; port: number }
  progress: ZplFontInstallProgress
}

export interface ZplFontInstallResult {
  sent: { weight: string; filename: string }[]
  skipped: { weight: string; filename: string }[]
  elapsedMs: number
  status: ZplFontStatus
  /** False when the printer could not be re-read — the proof label is the check. */
  verified: boolean
  message?: string
}

export type ZplFontResult<T> = { ok: true; data: T } | { ok: false; message: string }

export interface ZplFontInstallRequest {
  target: { host: string; port: number }
  force?: boolean
  weights?: string[]
  /** Resolution and media for the proof label a blind install prints. */
  dpi?: number
  widthMm?: number
  heightMm?: number
}

export interface ZplFontTestPrintRequest {
  target: { host: string; port: number }
  widthMm?: number
  heightMm?: number
  dpi?: number
}

export interface ElectronAPI {
  getSerialPorts: () => Promise<string[]>
  openSerialPort: (path: string, baudRate: number) => Promise<void>
  closeSerialPort: () => Promise<void>
  sendSerialData: (data: string) => Promise<void>
  onSerialData: (callback: (data: string) => void) => () => void

  getConfig: () => Promise<AppConfig>
  setConfig: (config: AppConfig) => Promise<AppConfig>
  encodeText: (request: TextEncodeRequest) => Promise<number[]>

  getNetworkIp: () => Promise<string | null>
  getAppVersion: () => Promise<string>
  restartApp: () => Promise<void>
  toggleFullscreen: () => Promise<void>
  toggleCustomerDisplay: () => Promise<void>

  scaleConnect: () => Promise<{ ok: boolean; message: string }>
  scaleDisconnect: () => Promise<void>
  scaleReadWeight: () => Promise<WeightResult>
  scaleStatus: () => Promise<{ connected: boolean }>
  onBarcodeScan: (callback: (barcode: string) => void) => () => void

  printLabel: (request: LabelSendRequest) => Promise<{ ok: boolean; message: string }>
  printEscpos: (request: EscposPrintRequest) => Promise<{ ok: boolean; message: string }>
  testEscposControlLines: (
    request: EscposControlLineMatrixRequest,
  ) => Promise<EscposControlLineMatrixResult>

  zplFontStatus: (
    target: { host: string; port: number },
    dpi?: number,
  ) => Promise<ZplFontResult<ZplFontStatus>>
  zplFontInstall: (
    request: ZplFontInstallRequest,
  ) => Promise<ZplFontResult<ZplFontInstallResult>>
  zplFontTestPrint: (
    request: ZplFontTestPrintRequest,
  ) => Promise<ZplFontResult<null>>
  onZplFontProgress: (callback: (event: ZplFontProgressEvent) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

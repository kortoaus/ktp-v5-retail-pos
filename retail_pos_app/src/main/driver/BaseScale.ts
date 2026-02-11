import { SerialPort } from 'serialport'
import type { ScaleConfig, WeightResult } from '../types'

const WEIGHT_TIMEOUT_MS = 1000

export abstract class BaseScale {
  protected port: SerialPort | null = null
  protected connected = false
  protected config: ScaleConfig

  constructor(config: ScaleConfig) {
    this.config = config
  }

  get isConnected(): boolean {
    return this.connected
  }

  async connect(): Promise<boolean> {
    if (this.port?.isOpen) return true

    const { path, baudRate, dataBits, stopBits, parity } = this.config

    return new Promise((resolve) => {
      this.port = new SerialPort({
        path,
        baudRate,
        dataBits: dataBits as 5 | 6 | 7 | 8,
        stopBits: stopBits as 1 | 1.5 | 2,
        parity,
        autoOpen: false
      })

      this.port.open((err) => {
        if (err) {
          this.connected = false
          resolve(false)
          return
        }

        this.connected = true
        this.port?.set({ dtr: true, rts: true })
        this.onConnected()
        resolve(true)
      })

      this.port.on('close', () => {
        this.connected = false
      })
    })
  }

  async disconnect(): Promise<void> {
    if (this.port?.isOpen) {
      try { this.port.close() } catch { }
    }
    this.connected = false
    this.port = null
  }

  abstract readWeight(): Promise<WeightResult>

  protected onConnected(): void { }

  protected maskMSB(data: Buffer): Buffer {
    const clean = Buffer.alloc(data.length)
    for (let i = 0; i < data.length; i++) {
      clean[i] = data[i] & 0x7f
    }
    return clean
  }

  protected disconnectedResult(): WeightResult {
    return { weight: 0, unit: 'kg', status: 'disconnected', message: 'Not connected' }
  }

  protected timeoutResult(): WeightResult {
    return { weight: 0, unit: 'kg', status: 'error', message: 'Timeout' }
  }

  protected errorResult(message: string): WeightResult {
    return { weight: 0, unit: 'kg', status: 'error', message }
  }

  static get TIMEOUT(): number {
    return WEIGHT_TIMEOUT_MS
  }
}

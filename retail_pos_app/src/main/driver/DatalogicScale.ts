import type { WeightResult } from '../types'
import { BaseScale } from './BaseScale'

const CR = 0x0d
const S11_CMD = 'S11\r'
const S11_PREFIX = 'S11'

export type BarcodeHandler = (barcode: string) => void

export class DatalogicScale extends BaseScale {
  private buffer: Buffer = Buffer.alloc(0)
  private latestWeight: WeightResult | null = null
  private onBarcode: BarcodeHandler | null = null

  setBarcodeHandler(handler: BarcodeHandler): void {
    this.onBarcode = handler
  }

  protected onConnected(): void {
    this.port?.on('data', (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, this.maskMSB(data)])
      this.processBuffer()
    })
  }

  private processBuffer(): void {
    let crIndex = this.buffer.indexOf(CR)

    while (crIndex !== -1) {
      const packetStr = this.buffer.subarray(0, crIndex).toString('ascii')
      this.buffer = this.buffer.subarray(crIndex + 1)

      if (packetStr.startsWith(S11_PREFIX)) {
        const weightStr = packetStr.substring(3, 8)
        const weightVal = parseInt(weightStr, 10)

        this.latestWeight = {
          weight: isNaN(weightVal) ? 0 : weightVal / 1000,
          unit: 'kg',
          status: 'stable'
        }
      } else if (packetStr.length > 0) {
        const barcode = packetStr.startsWith('S') ? packetStr.substring(3) : packetStr
        if (barcode.length > 0 && this.onBarcode) {
          this.onBarcode(barcode)
        }
      }

      crIndex = this.buffer.indexOf(CR)
    }
  }

  async readWeight(): Promise<WeightResult> {
    if (!this.connected || !this.port) return this.disconnectedResult()

    this.latestWeight = null

    return new Promise((resolve) => {
      this.port!.write(Buffer.from(S11_CMD, 'ascii'), (err) => {
        if (err) {
          resolve(this.errorResult(err.message))
          return
        }
      })

      const startTime = Date.now()
      const poll = setInterval(() => {
        if (this.latestWeight) {
          clearInterval(poll)
          resolve(this.latestWeight)
          return
        }

        if (Date.now() - startTime > BaseScale.TIMEOUT) {
          clearInterval(poll)
          resolve(this.timeoutResult())
        }
      }, 50)
    })
  }
}

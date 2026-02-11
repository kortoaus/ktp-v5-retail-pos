import type { WeightResult } from '../types'
import { BaseScale } from './BaseScale'

const STX = 0x02
const CR = 0x0d
const CMD_WEIGHT = 0x57 // 'W'

export class CasScale extends BaseScale {
  private buffer: Buffer = Buffer.alloc(0)

  async readWeight(): Promise<WeightResult> {
    if (!this.connected || !this.port) return this.disconnectedResult()

    this.buffer = Buffer.alloc(0)

    return new Promise((resolve) => {
      let resolved = false

      const cleanup = () => {
        if (dataHandler && this.port) {
          this.port.removeListener('data', dataHandler)
        }
        clearTimeout(timeout)
      }

      const finish = (result: WeightResult) => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve(result)
      }

      const timeout = setTimeout(() => finish(this.timeoutResult()), BaseScale.TIMEOUT)

      const dataHandler = (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, this.maskMSB(chunk)])

        let crIndex = -1
        let stxIndex = -1

        for (let i = this.buffer.length - 1; i >= 0; i--) {
          if (this.buffer[i] === CR) { crIndex = i; break }
        }

        if (crIndex !== -1) {
          for (let i = crIndex - 1; i >= 0; i--) {
            if (this.buffer[i] === STX) { stxIndex = i; break }
          }
        }

        if (stxIndex === -1 || crIndex === -1 || crIndex <= stxIndex) return

        const frameStr = this.buffer.subarray(stxIndex + 1, crIndex).toString('ascii')

        if (frameStr.includes('?')) {
          finish(this.errorResult('Scale error'))
          return
        }

        let weight: number
        if (frameStr.includes('.')) {
          weight = parseFloat(frameStr)
        } else {
          weight = parseInt(frameStr, 10) / 1000
        }

        finish({
          weight: isNaN(weight) ? 0 : weight,
          unit: 'kg',
          status: 'stable'
        })
      }

      this.port!.on('data', dataHandler)
      this.port!.write(Buffer.from([CMD_WEIGHT]), (err) => {
        if (err) finish(this.errorResult(err.message))
      })
    })
  }
}

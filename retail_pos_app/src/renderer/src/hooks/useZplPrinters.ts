import { useCallback, useEffect, useState } from 'react'
import type { LabelOutput } from '../libs/label-builder'

type LabelLanguage = 'zpl' | 'slcs'
type MediaSize = '7030' | '7090'

interface LabelPrinterSerial {
  type: 'serial'
  name: string
  language: LabelLanguage
  mediaSize?: MediaSize
  path: string
}

interface LabelPrinterNet {
  type: 'net'
  name: string
  language: LabelLanguage
  mediaSize?: MediaSize
  host: string
  port: number
}

export type LabelPrinter = LabelPrinterSerial | LabelPrinterNet

interface PrintResult {
  ok: boolean
  message: string
}

export function useZplPrinters() {
  const [printers, setPrinters] = useState<LabelPrinter[]>([])

  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const list: LabelPrinter[] = []

      for (const serial of config.devices.zplSerial) {
        list.push({
          type: 'serial',
          name: serial.name || serial.path,
          language: serial.language,
          mediaSize: serial.mediaSize,
          path: serial.path
        })
      }

      for (const net of config.devices.zplNet) {
        list.push({
          type: 'net',
          name: net.name || net.host,
          language: net.language,
          mediaSize: net.mediaSize,
          host: net.host,
          port: net.port
        })
      }

      setPrinters(list)
    })
  }, [])

  const printLabel = useCallback(
    async (printer: LabelPrinter, label: LabelOutput): Promise<PrintResult> => {
      return window.electronAPI.printLabel({
        printer: {
          type: printer.type,
          path: printer.type === 'serial' ? printer.path : undefined,
          host: printer.type === 'net' ? printer.host : undefined,
          port: printer.type === 'net' ? printer.port : undefined
        },
        label
      })
    },
    []
  )

  return { printers, printLabel }
}

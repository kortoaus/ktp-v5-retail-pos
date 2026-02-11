import { useCallback, useEffect, useState } from 'react'
import type { LabelOutput } from '../libs/label-builder'

type LabelLanguage = 'zpl' | 'slcs'

interface LabelPrinterSerial {
  type: 'serial'
  name: string
  language: LabelLanguage
  path: string
}

interface LabelPrinterNet {
  type: 'net'
  name: string
  language: LabelLanguage
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

      if (config.devices.zplSerial) {
        list.push({
          type: 'serial',
          name: 'Serial',
          language: config.devices.zplSerial.language,
          path: config.devices.zplSerial.path
        })
      }

      for (const net of config.devices.zplNet) {
        list.push({
          type: 'net',
          name: net.name || net.host,
          language: net.language,
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

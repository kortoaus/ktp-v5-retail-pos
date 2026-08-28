import { useCallback, useEffect, useState } from 'react'
import type { MediaId } from '../label-core/media'

type LabelLanguage = 'zpl' | 'slcs'

/**
 * What `label:print` accepts. Every label this app builds is a ZPL string since
 * the label-core cutover, so this is a single shape rather than a union — the
 * legacy `libs/label-builder.ts` that used to own the type (and its `slcs`
 * arm) was deleted with the rest of the legacy label stack. Mirrored, by hand,
 * in `src/main/types.ts` and `src/preload/index.d.ts`, which live outside the
 * renderer.
 */
type LabelOutput = { language: 'zpl'; data: string }

/**
 * The media a configured printer is loaded with — label-core's own id set, so
 * the two cannot drift. Widened from the three price/order sizes on 2026-08-26
 * to cover the scale (60 × 40) and ingredient (58 × 100) stock the templates
 * already build for. Mirrored, by hand, in `src/main/types.ts` and
 * `src/preload/index.d.ts`: those live outside the renderer and cannot import
 * from `label-core`.
 */
type MediaSize = MediaId

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

/**
 * Every printer loaded with this media, whatever dialect its row claims.
 *
 * `language` is deliberately not consulted. Since the label-core cutover every
 * label this app sends is ZPL — a row still typed `slcs` receives ZPL anyway
 * (owner decision, 2026-08-26), because the field records how the printer was
 * once configured, not what it can accept. Filtering on it here would silently
 * hide a working printer from the price-tag screens.
 */
export function pickLabelPrinters(
  printers: LabelPrinter[],
  media: MediaId
): LabelPrinter[] {
  return printers.filter((printer) => printer.mediaSize === media)
}

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

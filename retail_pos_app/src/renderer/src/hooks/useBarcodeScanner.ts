import { useEffect, useRef } from 'react'

const HID_MAX_KEYSTROKE_GAP_MS = 50
const HID_IDLE_CLEAR_MS = 300
const HID_MIN_LENGTH = 3

export function useBarcodeScanner(onScan: (barcode: string) => void): void {
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    const removeSerialListener = window.electronAPI.onBarcodeScan((barcode) => {
      onScanRef.current(barcode)
    })

    let buffer = ''
    let lastKeyTime = 0
    let clearTimer: ReturnType<typeof setTimeout> | null = null

    const resetBuffer = () => {
      buffer = ''
      lastKeyTime = 0
    }

    const scheduleClear = () => {
      if (clearTimer) clearTimeout(clearTimer)
      clearTimer = setTimeout(resetBuffer, HID_IDLE_CLEAR_MS)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now()

      if (now - lastKeyTime > HID_MAX_KEYSTROKE_GAP_MS && buffer.length > 0) {
        resetBuffer()
      }

      if (e.key === 'Enter') {
        if (clearTimer) clearTimeout(clearTimer)
        if (buffer.length >= HID_MIN_LENGTH) {
          onScanRef.current(buffer)
        }
        resetBuffer()
        return
      }

      if (e.key.length === 1) {
        buffer += e.key
        lastKeyTime = now
        scheduleClear()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      removeSerialListener()
      window.removeEventListener('keydown', handleKeyDown)
      if (clearTimer) clearTimeout(clearTimer)
    }
  }, [])
}

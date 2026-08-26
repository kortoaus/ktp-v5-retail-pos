import { useEffect, useRef } from 'react'
import { useDeviceMonitorStore } from '../store/DeviceMonitorStore'

const HID_MAX_KEYSTROKE_GAP_MS = 50
const HID_IDLE_CLEAR_MS = 300
const HID_MIN_LENGTH = 3

// e.key 대신 e.code 기반 매핑 — 한글 IME 켜져 있어도 물리 키 위치는 동일하므로
// US-QWERTY 기준 ASCII 로 복구 가능. 영문 모드면 `e.key` 로도 같은 결과, 한글
// 모드면 `e.key` 가 `ㄱ`/`ㄷ`/... 로 나와서 스캔 buffer 가 깨짐.
//
// 커버: 알파벳 / 숫자 / 흔한 기호. 미매핑 키는 null → buffer 에 추가 안 함
// (barcode/QR payload 는 ASCII 만 쓰므로 충분).
const SPECIAL: Record<string, [string, string]> = {
  Minus:        ['-', '_'],
  Equal:        ['=', '+'],
  BracketLeft:  ['[', '{'],
  BracketRight: [']', '}'],
  Backslash:    ['\\', '|'],
  Semicolon:    [';', ':'],
  Quote:        ["'", '"'],
  Comma:        [',', '<'],
  Period:       ['.', '>'],
  Slash:        ['/', '?'],
  Backquote:    ['`', '~'],
  Space:        [' ', ' '],
}

const SHIFT_DIGIT: Record<string, string> = {
  '0': ')', '1': '!', '2': '@', '3': '#', '4': '$',
  '5': '%', '6': '^', '7': '&', '8': '*', '9': '(',
}

function codeToChar(code: string, shift: boolean): string | null {
  // KeyA ~ KeyZ
  if (code.length === 4 && code.startsWith('Key')) {
    const letter = code.charAt(3)
    return shift ? letter : letter.toLowerCase()
  }
  // Digit0 ~ Digit9
  if (code.startsWith('Digit')) {
    const d = code.slice(5)
    return shift ? (SHIFT_DIGIT[d] ?? d) : d
  }
  // Numpad0 ~ Numpad9 (바코드 스캐너가 숫자패드 mode 사용하는 경우)
  if (code.startsWith('Numpad')) {
    const d = code.slice(6)
    if (/^\d$/.test(d)) return d
  }
  const pair = SPECIAL[code]
  if (pair) return shift ? pair[1] : pair[0]
  return null
}

export function useBarcodeScanner(onScan: (barcode: string) => void): void {
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    const emitScan = (barcode: string) => {
      const normalizedBarcode = barcode.replaceAll(' ', '')
      useDeviceMonitorStore.getState().setLastScannedBarcode(normalizedBarcode)
      onScanRef.current(normalizedBarcode)
    }

    const removeSerialListener = window.electronAPI.onBarcodeScan((barcode) => {
      emitScan(barcode)
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

      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (clearTimer) clearTimeout(clearTimer)
        if (buffer.length >= HID_MIN_LENGTH) {
          emitScan(buffer)
        }
        resetBuffer()
        return
      }

      // e.key 가 ASCII 인쇄 문자면 그대로 신뢰한다 — Shift 상태까지 정확하다.
      // 2D 스캐너는 Shift 를 별도 키 이벤트로 빠르게 보내서 e.shiftKey 가
      // false 로 잡히는 경우가 있어, e.code 매핑만 쓰면 `"`→`'`, `:`→`;`,
      // `{`→`[` 로 바뀌어 PP JSON 이 깨진다 (2026-08-26 실측). 한글 IME 로
      // e.key 가 `ㄱ` 같은 비ASCII 일 때만 기존 e.code 매핑으로 폴백.
      const char = /^[\x20-\x7e]$/.test(e.key) ? e.key : codeToChar(e.code, e.shiftKey)
      if (char != null) {
        buffer += char
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

import { useEffect, useRef } from 'react'

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

      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (clearTimer) clearTimeout(clearTimer)
        if (buffer.length >= HID_MIN_LENGTH) {
          onScanRef.current(buffer)
        }
        resetBuffer()
        return
      }

      const char = codeToChar(e.code, e.shiftKey)
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

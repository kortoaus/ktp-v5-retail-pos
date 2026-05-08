import { ipcMain } from 'electron'
import iconv from 'iconv-lite'
import type { TextEncodeRequest } from '../types'

function encodeAsciiReplace(text: string): number[] {
  const bytes: number[] = []

  for (const char of text) {
    if (char === '\n') {
      bytes.push(0x0a)
      continue
    }
    if (char === '\r') {
      bytes.push(0x0d)
      continue
    }

    const code = char.charCodeAt(0)
    bytes.push(code >= 0x20 && code <= 0x7e ? code : 0x3f)
  }

  return bytes
}

function encodeText(request: TextEncodeRequest): number[] {
  if (request.encoding === 'ascii-replace') {
    return encodeAsciiReplace(request.text)
  }

  const encoded = iconv.encode(request.text, request.encoding)
  return Array.from(encoded)
}

export function registerTextEncodingHandlers(): void {
  ipcMain.handle('text:encode', (_event, request: TextEncodeRequest) => {
    return encodeText(request)
  })
}

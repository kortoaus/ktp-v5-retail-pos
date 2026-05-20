import { cutCommand, initPrinterCommand } from "./escpos";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const BARCODE_TYPES = ["datamatrix", "qrcode", "code128"] as const;

export type BarcodeSlipType = (typeof BARCODE_TYPES)[number];

export interface BuildBarcodeSlipEscposOptions {
  type: BarcodeSlipType;
  value: string;
}

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  return buffer;
}

function asciiReplace(text: string): Uint8Array {
  const output: number[] = [];
  for (const char of text) {
    if (char === "\n") {
      output.push(LF);
      continue;
    }

    const code = char.charCodeAt(0);
    output.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
  }
  return new Uint8Array(output);
}

function commandLengthBytes(length: number): [number, number] {
  return [length & 0xff, (length >> 8) & 0xff];
}

function qrCommand(payload: string): Uint8Array {
  const data = asciiReplace(payload);
  const [pL, pH] = commandLengthBytes(data.length + 3);

  return concatBytes([
    bytes([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
    bytes([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    data,
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
  ]);
}

function code128Command(payload: string): Uint8Array {
  const data = asciiReplace(payload);
  if (data.length === 0) throw new Error("Barcode value is empty");
  if (data.length > 253) throw new Error("Code128 value is too long");

  return concatBytes([
    bytes([GS, 0x68, 0x70]),
    bytes([GS, 0x77, 0x03]),
    bytes([GS, 0x48, 0x02]),
    bytes([GS, 0x6b, 0x49, data.length + 2, 0x7b, 0x42]),
    data,
  ]);
}

function dataMatrixCommand(payload: string): Uint8Array {
  const data = asciiReplace(payload);
  if (data.length === 0) throw new Error("Barcode value is empty");

  const [pL, pH] = commandLengthBytes(data.length + 3);

  return concatBytes([
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x32, 0x43, 0x06]),
    bytes([GS, 0x28, 0x6b, pL, pH, 0x32, 0x50, 0x30]),
    data,
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x32, 0x51, 0x30]),
  ]);
}

function barcodeCommand(type: BarcodeSlipType, value: string): Uint8Array {
  if (type === "qrcode") return qrCommand(value);
  if (type === "code128") return code128Command(value);
  return dataMatrixCommand(value);
}

export function normalizeBarcodeValue(value: string): string {
  return value.trim();
}

export function buildBarcodeSlipEscpos(
  options: BuildBarcodeSlipEscposOptions,
): Uint8Array {
  const value = normalizeBarcodeValue(options.value);
  if (!value) throw new Error("Barcode value is empty");

  const humanText = asciiReplace(`${value}\n`);

  return concatBytes([
    initPrinterCommand(),
    bytes([ESC, 0x61, 0x01]),
    barcodeCommand(options.type, value),
    bytes([ESC, 0x64, 0x01]),
    humanText,
    bytes([ESC, 0x64, 0x03]),
    cutCommand(3),
  ]);
}

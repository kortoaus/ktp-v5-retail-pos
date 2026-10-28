// EFT receipt strings (merchant / customer, from the terminal side) → ESC/POS
// bytes for the till's receipt printer (retail-eftpos T-7, S-3 A-10). Printed
// as plain text, as received: init, the text (CRLF → LF, anything outside
// printable ASCII → "?"), feed, cut. The bytes go out through the existing
// path (libs/printer/print.service.ts printESCPOSResult — serial IPC or the
// store server's /api/printer/print relay). Pure.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export function eftReceiptText(text: string): string {
  const body = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return `${body}\n`;
}

export function buildEftReceiptBytes(text: string): Uint8Array {
  const out: number[] = [ESC, 0x40];
  for (const ch of eftReceiptText(text)) {
    if (ch === "\n") {
      out.push(LF);
      continue;
    }
    const code = ch.charCodeAt(0);
    out.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
  }
  out.push(LF, LF, LF, GS, 0x56, 0x42, 3);
  return new Uint8Array(out);
}

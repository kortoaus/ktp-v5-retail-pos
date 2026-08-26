/**
 * Width approximation, so a template can decide a font size without a printer.
 *
 * Deliberately crude. The printer, not this file, does the real line breaking
 * (^FB) and the real glyph advance; these ratios exist to answer "will this
 * plausibly fit" before emitting. Every consumer treats the result as a safety
 * margin — `fitSize` shrinking a line one step too far prints small, while the
 * alternative (trusting an exact metric we cannot have) prints clipped.
 *
 * Ratios are fractions of the em (the `^A@` cell height) for Noto Sans KR:
 * hangul and CJK are full-width by design, Latin is roughly half, digits are
 * tabular and slightly wider than the average letter, spaces are narrow.
 */

import type { BarcodeSymbology } from "./model";

export const EM_LATIN = 0.55;
export const EM_DIGIT = 0.58;
export const EM_CJK = 1.0;
export const EM_SPACE = 0.3;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Full-width ranges: hangul (syllables, jamo, compatibility jamo), CJK
 * ideographs, kana, CJK punctuation and the fullwidth forms block.
 */
function isFullWidth(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3130 && code <= 0x318f) ||
    (code >= 0x31f0 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

function charEm(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (ch === " " || ch === "\t") return EM_SPACE;
  if (code >= 0x30 && code <= 0x39) return EM_DIGIT;
  if (isFullWidth(code)) return EM_CJK;
  return EM_LATIN;
}

/** Advance of `text` in em units. */
export function textEm(text: string): number {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em;
}

/** Advance of `text` in dots when set at `size`. */
export function textWidth(text: string, size: number): number {
  return Math.ceil(textEm(text) * size);
}

/**
 * The largest integer size at or below `size` whose text fits `width`.
 *
 * Never returns less than `minSize`: a caller asking for a floor means the text
 * is unreadable below it, and printing something slightly clipped beats
 * printing something illegible. Width scales linearly with size, so this is a
 * division rather than a search.
 */
export function fitSize(text: string, width: number, size: number, minSize: number = 1): number {
  const floor = Math.max(1, Math.round(minSize));
  const em = textEm(text);
  if (em <= 0 || width <= 0) return Math.max(floor, Math.round(size));
  return clamp(Math.floor(width / em), floor, Math.round(size));
}

// ---------------------------------------------------------------------------
// Symbol geometry
// ---------------------------------------------------------------------------
// Bar counts are exact for the symbology; the dot widths they produce are used
// for layout packing and for the dbg outlines, not for anything the printer is
// told.

/** EAN-13 is a fixed 95 modules, plus the quiet zones the printer adds itself. */
export const EAN13_MODULES = 95;

/** Code 128: start + n data + check + stop(13), every symbol 11 modules. */
export function code128Modules(data: string): number {
  return 11 * (data.length + 2) + 13;
}

export function estimateBarcodeWidth(
  sym: BarcodeSymbology,
  data: string,
  module: number,
): number {
  const modules = sym === "ean13" ? EAN13_MODULES : code128Modules(data);
  return modules * Math.max(1, module);
}

/**
 * QR side in dots.
 *
 * Version is chosen by the printer from the payload, so this assumes the
 * 29-module version 3 that a short URL lands on. Longer payloads print bigger
 * than this says — layouts leave slack accordingly.
 */
export const QR_MODULES = 29;

export function estimateQrSize(mag: number): number {
  return QR_MODULES * Math.max(1, mag);
}

/** Data Matrix side in dots, assuming a 16x16 symbol (short payloads). */
export const DATAMATRIX_MODULES = 16;

export function estimateDataMatrixSize(size: number): number {
  return DATAMATRIX_MODULES * Math.max(1, size);
}

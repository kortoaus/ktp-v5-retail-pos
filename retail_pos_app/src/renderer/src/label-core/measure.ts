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
 *
 * The capital ratio is *not* a guess. Measured on a Zebra ZD421 with
 * Noto Sans KR Bold on 2026-08-26: in a 450-dot block at size 30, mixed-case
 * text ran out of room at ≈27 characters and UPPERCASE-only at ≈24 — that is
 * ≈0.56 em per character mixed and ≈0.63 em per character in caps. Caps
 * therefore get a class of their own; without it an all-caps product name
 * measures ~13% narrow and prints clipped. Lower-case keeps 0.55, which is what
 * makes a mixed string average out to the measured 0.56.
 */

import type { BarcodeSymbology } from "./model";

/** Lower-case Latin and any other proportional Latin glyph (punctuation…). */
export const EM_LATIN = 0.55;
/** `A`–`Z`. Hardware-measured, see the header — capitals are visibly wider. */
export const EM_UPPER = 0.63;
export const EM_DIGIT = 0.58;
export const EM_CJK = 1.0;
export const EM_SPACE = 0.3;
/**
 * `…` — three dots and the gaps between them, so nearer an em than a letter.
 *
 * U+2026 in Noto Sans KR advances a proportional (Latin-ish) width, not a full
 * CJK em — 1.0 here made every clip stop a character or two short of the block
 * (owner, 2026-08-28 hardware round: "ellipsis too conservative"). 0.6 tracks
 * the real advance closely enough that the FIT_SAFETY margin still covers it.
 */
export const EM_ELLIPSIS = 0.6;

/**
 * The clip marker, U+2026.
 *
 * In the printer's font: `scripts/subset-noto-kr.py` keeps `U+2010-2027`, so
 * the subset that is `~DY`-injected into the printer's flash carries it. If
 * that range ever narrows, change this to `"..."` — nothing else needs to move,
 * because every width here is measured rather than assumed.
 */
export const ELLIPSIS = "…";
const ELLIPSIS_CODE = 0x2026;

/**
 * Fraction of a block a line is fitted against, rather than the whole of it.
 *
 * The ratios above are an approximation and the hardware run of 2026-08-28
 * showed them running slightly *narrow* — text this file called a fit came off
 * the printer overlapped. Three percent is the cheapest way to buy back that
 * error; it costs a character on a name that was already at the edge.
 */
export const FIT_SAFETY = 0.97;

/** Floor for a shrunk text field that gave no `minSize` of its own. */
export const DEFAULT_MIN_TEXT_SIZE = 12;

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
  if (code === ELLIPSIS_CODE) return EM_ELLIPSIS;
  if (code >= 0x30 && code <= 0x39) return EM_DIGIT;
  // `A`–`Z` only. Accented capitals are rare in a product name here and fall
  // through to the Latin ratio, which under-measures them slightly — the same
  // direction of error the whole file already accepts.
  if (code >= 0x41 && code <= 0x5a) return EM_UPPER;
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

/**
 * How many lines `text` will wrap to inside `width` when set at `size`.
 *
 * The printer's own ^FB does the real breaking; this exists so a template can
 * advance its cursor past a block it has not printed yet. It breaks on spaces
 * where there are any and between characters otherwise, which is what ^FB does
 * with hangul, and it never reports more than `max`.
 */
export function estimateLines(
  text: string,
  size: number,
  width: number,
  max: number = Number.MAX_SAFE_INTEGER,
): number {
  if (!text || width <= 0 || size <= 0) return 0;

  const budget = width / size;
  const tokens = text.includes(" ") ? text.split(/\s+/).filter(Boolean) : Array.from(text);
  const glue = text.includes(" ") ? EM_SPACE : 0;

  let lines = 1;
  let used = 0;
  for (const token of tokens) {
    const em = textEm(token);
    const next = used === 0 ? em : used + glue + em;
    if (next <= budget || used === 0) {
      used = next;
      continue;
    }
    lines += 1;
    used = em;
    if (lines >= max) return max;
  }
  return Math.min(lines, max);
}

// ---------------------------------------------------------------------------
// Clipping
// ---------------------------------------------------------------------------
//
// ## Why this exists (hardware, 2026-08-28)
//
// `^FB` **does not truncate**. Given more text than its block can hold, a Zebra
// keeps drawing the overflow *on the last line it was given* — the printed
// result is two strings on top of each other. A photo of a 70 × 30 tag came back
// reading `Botttlashait.RonDreShoup`: an English name set at its 18-dot floor in
// a 252-dot block, folded onto itself.
//
// So "shrink to the floor and hope" is not a safe fallback, and neither is any
// measurement that runs a little narrow. Every text element that declares a
// block width now has its text cut to something that measurably fits, with `…`
// marking the cut. Shrinking still happens first — the clip is the last resort,
// not the first.

/**
 * The longest prefix of `text` that satisfies `fits`, marked with an ellipsis.
 *
 * Returns `text` untouched when it already fits, which is the common case; the
 * per-character walk only runs on a string that is actually too long, and those
 * are product names, not paragraphs. Trailing whitespace is dropped before the
 * marker so a cut at a word boundary does not print `word …`.
 */
function longestPrefix(
  text: string,
  fits: (candidate: string) => boolean,
  marker: string = ELLIPSIS,
): string {
  if (fits(text)) return text;

  const chars = Array.from(text);
  for (let keep = chars.length - 1; keep > 0; keep -= 1) {
    const candidate = chars.slice(0, keep).join("").trimEnd() + marker;
    if (fits(candidate)) return candidate;
  }
  // Not even one character and the marker fit. Print the marker if it fits on
  // its own, otherwise nothing — an empty field is ugly, overlapped ink is a
  // reprint.
  return marker && fits(marker) ? marker : "";
}

/**
 * Fits, in em-dots rather than whole dots.
 *
 * `textWidth` rounds up to a whole dot and `fitSize` rounds its division down,
 * so the two disagree by up to one dot — enough to make a line that `fitSize`
 * just chose a size for look, to `textWidth`, like it needs clipping. Comparing
 * the unrounded advance keeps the two in step; the missing dot is inside the
 * `FIT_SAFETY` margin either way.
 */
function fitsWidth(text: string, size: number, maxW: number): boolean {
  return textEm(text) * size <= maxW;
}

/**
 * `text` cut until it measures no wider than `maxW` at `size`.
 *
 * Pure geometry: no safety factor is applied here, so callers that want one
 * pass an already-reduced `maxW` (see `clipToBlock`).
 */
export function clipToWidth(text: string, size: number, maxW: number): string {
  if (!text || maxW <= 0 || size <= 0) return text;
  return longestPrefix(text, (candidate) => fitsWidth(candidate, size, maxW));
}

/**
 * `text` cut until it fits a `^FB` block of `width` × `lines` at `size`.
 *
 * Two conditions, because a block has two ways to overflow: the total advance
 * has to fit the block's whole area, *and* the text has to wrap into no more
 * than `lines` rows — a name that measures 1.9 lines wide can still need three
 * rows once the wrap wastes the end of each one. `estimateLines` is the same
 * wrap model the templates use to place what comes after the block, so both
 * agree by construction.
 *
 * `safety` is deliberately *not* charged to text that already fits. A date in a
 * 70-dot block that measures 69 is a date the hardware prints correctly, and
 * clipping it to `27/0…` to buy a margin nobody needed is a worse label. The
 * margin is spent only once the string has to be cut anyway, where it is free:
 * the cut is already losing a character, so it may as well lose it with room to
 * spare.
 */
export function clipToBlock(
  text: string,
  size: number,
  width: number,
  lines: number = 1,
  safety: number = FIT_SAFETY,
  marker: string = ELLIPSIS,
): string {
  if (!text || width <= 0 || size <= 0) return text;

  const rows = Math.max(1, Math.round(lines));
  const fits = (candidate: string, budget: number): boolean =>
    fitsWidth(candidate, size, width * rows * budget) &&
    (rows === 1 || estimateLines(candidate, size, width * budget, rows + 1) <= rows);

  if (fits(text, 1)) return text;
  return longestPrefix(text, (candidate) => fits(candidate, safety), marker);
}

/**
 * Wrap `text` onto rows that may each be a different width.
 *
 * ## Why a template would do its own wrapping
 *
 * `^FB` wraps, but on the printer's terms: one width for the whole block, and
 * leading of its own choosing (the font's height, not a number we pass). A
 * layout that needs *uniform* leading, or a last row narrower than the ones
 * above it — because that row runs alongside something else, like the 70 × 30
 * tag's barcode digits — cannot be one `^FB` block at all. It has to be one
 * element per row, and that means deciding the breaks here.
 *
 * Same wrap model as `estimateLines`, so the two agree: break on spaces where
 * the string has any and between characters otherwise (which is what `^FB` does
 * with hangul), and never break a token that is alone on its row.
 *
 * Returns at most `widths.length` rows. Whatever is left over when the last row
 * fills up is **kept on that row** rather than dropped, so the caller sees a row
 * that is too long and can cut it with `clipToBlock` — losing text silently is
 * how a name ends up truncated with nothing to say it was.
 */
export function wrapToWidths(text: string, size: number, widths: number[]): string[] {
  const trimmed = text.trim();
  if (!trimmed || widths.length === 0 || size <= 0) return [];

  const bySpace = trimmed.includes(" ");
  const tokens = bySpace ? trimmed.split(/\s+/).filter(Boolean) : Array.from(trimmed);
  const glue = bySpace ? " " : "";

  const rows: string[] = [];
  let row = "";

  for (const token of tokens) {
    const next = row ? row + glue + token : token;
    const lastRow = rows.length === widths.length - 1;
    if (!row || lastRow || textEm(next) * size <= widths[rows.length]) {
      row = next;
      continue;
    }
    rows.push(row);
    row = token;
  }
  if (row) rows.push(row);

  return rows;
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
 * Version is chosen by the printer from the payload, so with no payload given
 * this assumes the 29-module version 3 that a short URL lands on. Longer
 * payloads print bigger than that says — layouts that cannot leave slack pass
 * the byte length and get the real version instead.
 */
export const QR_MODULES = 29;

/**
 * Byte-mode payload capacity per QR version at error-correction level **L**.
 *
 * L, byte mode, and nothing else, because that is what the emitter sends: the
 * `LA,` field-data prefix asks for level L and automatic input mode, and any
 * payload with a brace or a quote in it (every PP payload does) leaves
 * automatic mode in byte mode. Versions 1–10 are enough — v10 holds 271 bytes
 * and the largest payload this library prints is a ~147-byte PP string.
 *
 * Figures are the ISO/IEC 18004 table; index 0 is version 1.
 */
export const QR_L_BYTE_CAPACITY = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271];

/** Side of a QR version in modules — 21 at v1, +4 per version. */
export function qrVersionModules(version: number): number {
  return 21 + 4 * (clamp(Math.round(version), 1, 40) - 1);
}

/**
 * UTF-8 byte length, without `Buffer` or `TextEncoder`.
 *
 * The printer counts bytes, not code points, and this file may not import
 * anything platform-shaped (see `index.ts`), so the count is done by hand.
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Modules per side for a payload of `byteLength` bytes at EC level L.
 *
 * Omit the length and you get the v3 assumption the layouts that cannot know
 * their payload were tuned against. A payload past v10 is clamped to v10 rather
 * than throwing — an under-estimate draws a small debug box, an exception loses
 * the label.
 */
export function qrModules(byteLength?: number): number {
  if (byteLength == null) return QR_MODULES;
  const index = QR_L_BYTE_CAPACITY.findIndex((cap) => byteLength <= cap);
  return qrVersionModules(index === -1 ? QR_L_BYTE_CAPACITY.length : index + 1);
}

export function estimateQrSize(mag: number, byteLength?: number): number {
  return qrModules(byteLength) * Math.max(1, mag);
}

/** Data Matrix side in dots, assuming a 16x16 symbol (short payloads). */
export const DATAMATRIX_MODULES = 16;

export function estimateDataMatrixSize(size: number): number {
  return DATAMATRIX_MODULES * Math.max(1, size);
}


// Moved from templates/order-100100.ts so any template may pick a QR
// magnification for a box without importing another template.
const QR_MAG_MAX = 10;
const QR_MAG_MIN = 2;

/**
 * The largest magnification whose estimated symbol fits the box interior.
 *
 * `estimateQrSize` is payload-aware — the same estimate `elementBounds` uses to
 * derive a bottom-anchored symbol's top edge — so what this returns and what
 * the debug outline draws cannot disagree. Stepping down rather than solving in
 * closed form keeps the height test (which is what the caption constrains) and
 * the width test in one place.
 */
export function qrMagForBox(data: string, maxW: number, maxH: number): number {
  const bytes = utf8Length(data);
  for (let mag = QR_MAG_MAX; mag > QR_MAG_MIN; mag -= 1) {
    const side = estimateQrSize(mag, bytes);
    if (side <= maxW && side <= maxH) return mag;
  }
  return QR_MAG_MIN;
}

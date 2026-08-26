/**
 * One label that exercises every element kind, on any of the five media.
 *
 * This is the tuning instrument for step ② of the label rewrite: print it on
 * real stock, look at what is crooked, and fix the emitter or the media table
 * rather than guessing at a template. So it is laid out from the media's own
 * dot dimensions — nothing here is authored for one label size and scaled — and
 * it deliberately contains the awkward cases:
 *
 *   - hangul in all three weights, which fails silently if a face was never
 *     pushed to the printer's flash (B and BK are not installed on the XD3 yet,
 *     so those rows printing blank is expected, not a bug in this file);
 *   - a shrink field asked for twice the row size, so the shrink path is
 *     actually taken rather than being a no-op;
 *   - both barcode symbologies with their human-readable line, at a module
 *     width a scanner would actually accept, each paired with a 2D symbol.
 *
 * With `dbg` on, every element also gets a 1-dot outline — the fastest way to
 * see whether a field landed where the layout thought it would.
 */

import {
  clamp,
  code128Modules,
  DATAMATRIX_MODULES,
  EAN13_MODULES,
  estimateDataMatrixSize,
  estimateQrSize,
  fitSize,
  QR_MODULES,
} from "./measure";
import { getMedia, type MediaId } from "./media";
import { strike, STRIKE_THICK, type Element, type Label } from "./model";
import { HRI_HEIGHT } from "./zpl";

/** Quiet zone from the label edge, in dots. */
const MARGIN = 8;

/** Text row height as a fraction of label height, then clamped to readability. */
const TEXT_SIZE_RATIO = 0.07;
const MIN_TEXT_SIZE = 14;
const MAX_TEXT_SIZE = 34;

/** Floor for the shrink demo — below this hangul stops being legible at 203 dpi. */
const SHRINK_MIN_SIZE = 10;

const BOX_THICK = 2;
const BOX_PAD = 6;

const MIN_BAR_HEIGHT = 20;
const MAX_BAR_HEIGHT = 140;

/**
 * Module ceilings.
 *
 * EAN-13's nominal symbol is 37.3 mm wide, which at 203 dpi is a module of
 * about 2.6 dots; 3 lands within the tolerance a scanner expects, 4 overshoots
 * it. Code 128 has no nominal width, so it only has to stay inside the label.
 */
const MAX_EAN13_MODULE = 3;
const MAX_CODE128_MODULE = 4;
const MAX_QR_MAG = 8;
const MAX_DM_SIZE = 10;

/** 12 digits: EAN-13's thirteenth is the printer's own check digit. */
export const DIAGNOSTIC_EAN13 = "930000000011";
export const DIAGNOSTIC_CODE128 = "KTPV5-LBL";
export const DIAGNOSTIC_QR = "https://ktpv5.local/label-core";
export const DIAGNOSTIC_DATAMATRIX = "KTPV5-DM";

/** Long enough that it shrinks on the widest media too, not just the narrow ones. */
export const DIAGNOSTIC_SHRINK_TEXT =
  "축소 테스트 — 이 줄은 라벨 폭에 맞춰 줄어듭니다 ABC 0123456789";

export interface DiagnosticOptions {
  dbg?: boolean;
  copies?: number;
}

export function buildDiagnosticLabel(
  mediaId: MediaId,
  opts: DiagnosticOptions = {},
): Label {
  const media = getMedia(mediaId);
  const [pageW, pageH] = media.dots;
  const usableW = pageW - MARGIN * 2;

  const textSize = clamp(Math.round(pageH * TEXT_SIZE_RATIO), MIN_TEXT_SIZE, MAX_TEXT_SIZE);
  const gap = Math.max(4, Math.round(textSize * 0.35));

  const elements: Element[] = [];
  let y = MARGIN;

  // ── text: one row per installed weight ────────────────────────────────────
  const row = (text: string, weight: "M" | "B" | "BK"): void => {
    elements.push({
      kind: "text",
      x: MARGIN,
      y,
      text,
      size: textSize,
      weight,
      width: usableW,
      lines: 1,
      align: "L",
    });
    y += textSize + gap;
  };

  row(`M ${mediaId} ${pageW}x${pageH} 가나다`, "M");
  row("B 볼드 가나다라 ABC 123", "B");
  row("BK 블랙 가나다라 ABC 123", "BK");

  // ── text: the shrink path ─────────────────────────────────────────────────
  // The size asked for is deliberately unreachable; the emitter will resolve it
  // down, so the row advance has to resolve it the same way.
  const shrinkAsked = textSize * 2;
  const shrinkSize = fitSize(DIAGNOSTIC_SHRINK_TEXT, usableW, shrinkAsked, SHRINK_MIN_SIZE);
  elements.push({
    kind: "text",
    x: MARGIN,
    y,
    text: DIAGNOSTIC_SHRINK_TEXT,
    size: shrinkAsked,
    weight: "M",
    width: usableW,
    lines: 1,
    align: "C",
    shrink: true,
    minSize: SHRINK_MIN_SIZE,
  });
  y += shrinkSize + gap;

  // ── line ──────────────────────────────────────────────────────────────────
  elements.push(strike(MARGIN, y, usableW));
  y += STRIKE_THICK + gap;

  // ── box + the four symbols inside it ──────────────────────────────────────
  // Two rows, a linear barcode on the left and a 2D symbol on the right of
  // each. All four side by side would fit only by driving the module width down
  // to one dot, which prints an EAN-13 a third of its nominal size — legible on
  // paper, unreadable to a scanner, and therefore useless as a diagnostic.
  const bottomH = pageH - y - MARGIN;
  const inset = BOX_PAD + BOX_THICK;
  const rowGap = 6;

  const rowBudget = Math.floor((bottomH - inset * 2 - rowGap) / 2);
  const barHeight = clamp(rowBudget - HRI_HEIGHT, MIN_BAR_HEIGHT, MAX_BAR_HEIGHT);
  const rowH = barHeight + HRI_HEIGHT;
  const boxH = rowH * 2 + rowGap + inset * 2;

  elements.push({ kind: "box", x: MARGIN, y, w: usableW, h: boxH, thick: BOX_THICK });

  const innerW = usableW - inset * 2;
  const colGap = Math.max(6, Math.round(innerW * 0.02));
  const leftX = MARGIN + inset;
  const rightEdge = MARGIN + usableW - inset;

  // The 2D symbols are square, so their size is bounded by the row height as
  // well as by the quarter of the row width they are allowed to take.
  const squareBudget = Math.min(rowH, innerW * 0.25);
  const qrMag = clamp(Math.floor(squareBudget / QR_MODULES), 1, MAX_QR_MAG);
  const dmSize = clamp(Math.floor(squareBudget / DATAMATRIX_MODULES), 2, MAX_DM_SIZE);
  const qrW = estimateQrSize(qrMag);
  const dmW = estimateDataMatrixSize(dmSize);

  const eanModule = clamp(
    Math.floor((innerW - qrW - colGap) / EAN13_MODULES),
    1,
    MAX_EAN13_MODULE,
  );
  const code128Module = clamp(
    Math.floor((innerW - dmW - colGap) / code128Modules(DIAGNOSTIC_CODE128)),
    1,
    MAX_CODE128_MODULE,
  );

  const rowAY = y + inset;
  const rowBY = rowAY + rowH + rowGap;

  elements.push({
    kind: "barcode",
    sym: "ean13",
    x: leftX,
    y: rowAY,
    h: barHeight,
    module: eanModule,
    hri: true,
    data: DIAGNOSTIC_EAN13,
  });
  elements.push({
    kind: "qr",
    x: rightEdge - qrW,
    y: rowAY,
    mag: qrMag,
    ec: "M",
    data: DIAGNOSTIC_QR,
  });

  elements.push({
    kind: "barcode",
    sym: "code128",
    x: leftX,
    y: rowBY,
    h: barHeight,
    module: code128Module,
    hri: true,
    data: DIAGNOSTIC_CODE128,
  });
  elements.push({
    kind: "datamatrix",
    x: rightEdge - dmW,
    y: rowBY,
    size: dmSize,
    data: DIAGNOSTIC_DATAMATRIX,
  });

  return {
    media: mediaId,
    elements,
    dbg: opts.dbg ?? false,
    ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
  };
}

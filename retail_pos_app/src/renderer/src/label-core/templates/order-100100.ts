/**
 * 100 × 100 order label — order slip, work instruction and product label in one.
 *
 * Ported from `components/orders/order-label-zpl.ts`, with the two changes the
 * original's own header comment asked for:
 *
 *   - **The Korean name line is real.** That builder emitted `^A0` with no
 *     `^CI`, so it could not print hangul and gated the `name_ko` line behind an
 *     "is it ASCII" test that always failed. With `^CI28` and the Noto faces
 *     the line simply prints.
 *   - **The two placeholder boxes hold real symbols.** They were drawn as empty
 *     rectangles captioned `ORDER QR` / `PP QR` because a pure-string builder
 *     could not produce a bitmap. `^BQ` is a command, not a bitmap, so the
 *     order QR is now mandatory and the PP box appears only when there is a PP
 *     payload to put in it — an empty box on a 100 mm label is a large way to
 *     print nothing.
 *
 * The media is 800 × 800 (100 mm at 8 dots/mm). The old file said 812, which is
 * neither 100 mm nor any other round number.
 *
 * Option lines are wrapped by character count rather than by measured width.
 * That is deliberate: the `+N more` rule needs to know how many lines there are
 * before any of them is emitted, and a character count is the same on every
 * machine. At 32 dots a 42-character line is about 740 dots, which is what the
 * content column is.
 */

import { estimateQrSize, fitSize, utf8Length } from "../measure";
import { type Element, type Label } from "../model";
import { clippedTextEl, textEl, type TemplateOptions } from "./scale-6040";

export interface OrderLabelInput {
  orderNo: string;
  /**
   * Already formatted by the caller — the server's `dueAt` is never recomputed
   * here. The expected format is moment's `ddd Do MMM HH:mm`, e.g.
   * `Thu 27th Aug 14:00`. Null or empty prints `-` rather than dropping the
   * word: a due line that is simply absent reads as "no deadline".
   */
  dueText?: string | null;
  nameKo: string;
  nameEn: string;
  qty: number;
  /** Unit of measure printed beside the quantity, e.g. `ea`, `kg`. */
  uom: string;
  /** One string per option, e.g. `Wasabi: Extra x1`. Wrapped and capped here. */
  optionLines: string[];
  orderQrData: string;
  ppQrData?: string | null;
}

const W = 800;
const H = 800;
const PAD = 24;
const CONTENT_W = W - PAD * 2;

const NAME_SIZE = 54;
const NAME_LH = 62;
const NAME_WRAP = 24;
const NAME_MAX_LINES = 2;
const KO_SIZE = 34;
const KO_LH = 42;
const OPTION_SIZE = 32;
const OPTION_LH = 38;
const OPTION_WRAP = 42;
const QTY_SIZE = 68;
/**
 * Below this the quantity stops being the line you read from across a bench,
 * which is the only reason it is set at 68 in the first place. A due date long
 * enough to push past this prints slightly clipped rather than illegibly small.
 */
const QTY_MIN_SIZE = 40;
const FOOTER_SIZE = 24;

const BOX = 220;
const BOX_THICK = 3;
const BOX_Y = H - PAD - BOX;
const BOX_LEFT_X = PAD;
const BOX_RIGHT_X = W - PAD - BOX;
/**
 * Derived from the box top and the *asked* size, not the fitted one, so the
 * line keeps its place on the label whether or not the due text shrank it.
 */
const QTY_Y = BOX_Y - 16 - QTY_SIZE;

/** Caption inside the top of a symbol box, then the symbol under it. */
const BOX_CAPTION_SIZE = 24;
const BOX_CAPTION_DY = 6;

// ── QR sizing ──────────────────────────────────────────────────────────────
//
// Both symbols are *bottom*-anchored: see `QrAnchor` in ../model. Zebra
// bottom-aligns ^BQ inside a box sized for the magnification's largest symbol,
// so under ^FO the printed top edge moves with the payload length and a symbol
// that fits the sample drifts out of its 220-dot box on a longer one. ^FT pins
// the bottom-left corner instead and the symbol grows upward, which is the only
// edge that has room here.
//
// The magnification is computed per payload rather than fixed, because the two
// payloads are nowhere near the same size: the order QR is `order%%%<id>`
// (~11 bytes → version 1, 21 modules) and the PP QR is the full JSON price
// string (~124 bytes → version 6, 41 modules). One magnification cannot serve
// both — the 5 this file used to hardcode drew a 105-dot order symbol lost in a
// 220-dot box and a 205-dot PP symbol that overflowed it.
//
/** Border thickness plus a few dots of quiet zone, on every inner edge. */
const QR_QUIET = 3;
const QR_PAD = BOX_THICK + QR_QUIET;
/** Clear air between the caption's baseline band and the top of the symbol. */
const QR_CAPTION_GAP = 4;
const QR_MAG_MIN = 2;
const QR_MAG_MAX = 10;

/** The symbol's bottom-left anchor, and the ceiling the caption leaves it. */
const QR_BOTTOM_Y = BOX_Y + BOX - QR_PAD;
const QR_TOP_LIMIT = BOX_Y + BOX_CAPTION_DY + BOX_CAPTION_SIZE + QR_CAPTION_GAP;
const QR_MAX_W = BOX - QR_PAD * 2;
const QR_MAX_H = QR_BOTTOM_Y - QR_TOP_LIMIT;

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

/**
 * Greedy wrap on spaces, falling back to a hard break for a single long word.
 *
 * Ported verbatim from the original builder so the `+N more` arithmetic below
 * counts the same lines it always did.
 */
export function wrapChars(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const lines: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let breakAt = rest.lastIndexOf(" ", max);
    if (breakAt <= 0) breakAt = max;
    lines.push(rest.slice(0, breakAt));
    rest = rest.slice(breakAt).trimStart();
  }
  if (rest.length > 0) lines.push(rest);
  return lines;
}

/**
 * As many option lines as fit above the QTY block, with the overflow counted.
 *
 * The last visible line is spent on `+N more` rather than on another option:
 * a truncated list that does not say it was truncated is how someone packs the
 * wrong order.
 */
export function fitOptionLines(lines: string[], maxLines: number): string[] {
  const cap = Math.max(1, maxLines);
  if (lines.length <= cap) return lines;
  return [...lines.slice(0, cap - 1), `+${lines.length - (cap - 1)} more`];
}

/**
 * The one line that carries both numbers someone packing needs: how many, and
 * by when.
 *
 * They used to be two elements a hand's width apart — the quantity above the
 * symbol boxes and a `Due …` line down between them — which is two places to
 * look and one of them small. Joined, the due time inherits the quantity's
 * 68-dot black and the footer keeps only the order number.
 */
export function orderQtyLine(qty: number, uom: string, dueText?: string | null): string {
  const unit = uom.trim().toUpperCase();
  const due = dueText?.trim();
  return `${qty}${unit ? ` ${unit}` : ""} / ${due || "-"}`;
}

function symbolBox(x: number, caption: string, data: string): Element[] {
  return [
    { kind: "box", x, y: BOX_Y, w: BOX, h: BOX, thick: BOX_THICK },
    textEl(x, BOX_Y + BOX_CAPTION_DY, caption, BOX_CAPTION_SIZE, "M", {
      width: BOX,
      lines: 1,
      align: "C",
    }),
    {
      kind: "qr",
      x: x + QR_PAD,
      y: QR_BOTTOM_Y,
      mag: qrMagForBox(data, QR_MAX_W, QR_MAX_H),
      anchor: "bottom",
      ec: "M",
      data,
    },
  ];
}

export function buildOrderLabel100100(
  input: OrderLabelInput,
  opts: TemplateOptions = {},
): Label {
  const elements: Element[] = [];
  let y = PAD;

  // ── product name, English first and large ────────────────────────────────
  const nameEn = input.nameEn.trim();
  const enLines = nameEn ? wrapChars(nameEn, NAME_WRAP).slice(0, NAME_MAX_LINES) : [];
  for (const line of enLines) {
    elements.push(
      clippedTextEl(PAD, y, line, NAME_SIZE, "B", { width: CONTENT_W, lines: 1, align: "L" }),
    );
    y += NAME_LH;
  }

  const nameKo = input.nameKo.trim();
  if (nameKo) {
    elements.push(
      clippedTextEl(PAD, y, nameKo, KO_SIZE, "B", { width: CONTENT_W, lines: 1, align: "L" }),
    );
    y += KO_LH;
  }

  // ── rule ─────────────────────────────────────────────────────────────────
  y += 4;
  elements.push({ kind: "line", x: PAD, y, w: CONTENT_W, h: 3, thick: 3 });
  y += 14;

  // ── options: the work instruction ────────────────────────────────────────
  const optionLines = input.optionLines
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => wrapChars(line, OPTION_WRAP));
  const maxOptionLines = Math.max(1, Math.floor((QTY_Y - 12 - y) / OPTION_LH));

  for (const line of fitOptionLines(optionLines, maxOptionLines)) {
    elements.push(
      clippedTextEl(PAD, y, line, OPTION_SIZE, "M", { width: CONTENT_W, lines: 1, align: "L" }),
    );
    y += OPTION_LH;
  }

  // ── quantity and due, one line ───────────────────────────────────────────
  //
  // `fitSize` is the same measurement the name band and the scale label's date
  // row fit against, uppercase ratio included — `EA` and a month abbreviation
  // are most of this string, and capitals measure 0.63 em rather than 0.55.
  // One line is the point of joining the two, so the block is `lines: 1` and
  // the size steps down until the whole string fits `CONTENT_W`.
  const qtyLine = orderQtyLine(input.qty, input.uom, input.dueText);
  elements.push(
    clippedTextEl(PAD, QTY_Y, qtyLine, fitSize(qtyLine, CONTENT_W, QTY_SIZE, QTY_MIN_SIZE), "BK", {
      width: CONTENT_W,
      lines: 1,
      align: "L",
    }),
  );

  // ── symbols, and the order number between them ───────────────────────────
  elements.push(...symbolBox(BOX_LEFT_X, "ORDER", input.orderQrData));
  if (input.ppQrData) {
    elements.push(...symbolBox(BOX_RIGHT_X, "PP", input.ppQrData));
  }

  // The order number is all that is left between the boxes — the `Due …` line
  // that used to sit under it now rides with the quantity — so it centres in
  // the box band rather than hanging above where a second line once was.
  const footerX = BOX_LEFT_X + BOX + 12;
  const footerW = BOX_RIGHT_X - footerX - 12;
  const footerY = BOX_Y + (BOX - FOOTER_SIZE) / 2;

  elements.push(
    clippedTextEl(footerX, footerY, input.orderNo.trim() || "-", FOOTER_SIZE, "B", {
      width: footerW,
      lines: 1,
      align: "C",
    }),
  );

  return {
    media: "100100",
    elements,
    dbg: opts.dbg ?? false,
    ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
  };
}

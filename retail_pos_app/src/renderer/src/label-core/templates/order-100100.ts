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

import { type Element, type Label } from "../model";
import { textEl, type TemplateOptions } from "./scale-6040";

export interface OrderLabelInput {
  orderNo: string;
  /** Already formatted by the caller — the server's `dueAt` is never recomputed here. */
  dueText?: string | null;
  nameKo: string;
  nameEn: string;
  qty: number;
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
const FOOTER_SIZE = 24;

const BOX = 220;
const BOX_Y = H - PAD - BOX;
const BOX_LEFT_X = PAD;
const BOX_RIGHT_X = W - PAD - BOX;
const QTY_Y = BOX_Y - 16 - QTY_SIZE;

/** Caption inside the top of a symbol box, then the symbol under it. */
const BOX_CAPTION_SIZE = 24;
const BOX_CAPTION_DY = 6;
const QR_DY = 34;
const QR_MAG = 5;
/** A version-4 QR at magnification 5 — 165 dots — with room to spare in the box. */
const QR_ESTIMATED = 145;

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

function symbolBox(x: number, caption: string, data: string): Element[] {
  const qrX = x + Math.round((BOX - QR_ESTIMATED) / 2);
  return [
    { kind: "box", x, y: BOX_Y, w: BOX, h: BOX, thick: 3 },
    textEl(x, BOX_Y + BOX_CAPTION_DY, caption, BOX_CAPTION_SIZE, "M", {
      width: BOX,
      lines: 1,
      align: "C",
    }),
    { kind: "qr", x: qrX, y: BOX_Y + QR_DY, mag: QR_MAG, ec: "M", data },
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
      textEl(PAD, y, line, NAME_SIZE, "B", { width: CONTENT_W, lines: 1, align: "L" }),
    );
    y += NAME_LH;
  }

  const nameKo = input.nameKo.trim();
  if (nameKo) {
    elements.push(
      textEl(PAD, y, nameKo, KO_SIZE, "B", { width: CONTENT_W, lines: 1, align: "L" }),
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
      textEl(PAD, y, line, OPTION_SIZE, "M", { width: CONTENT_W, lines: 1, align: "L" }),
    );
    y += OPTION_LH;
  }

  // ── quantity ─────────────────────────────────────────────────────────────
  elements.push(
    textEl(PAD, QTY_Y, `QTY ${input.qty}`, QTY_SIZE, "BK", {
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

  const footerX = BOX_LEFT_X + BOX + 12;
  const footerW = BOX_RIGHT_X - footerX - 12;
  const footerY = BOX_Y + BOX / 2 - 34;
  const due = input.dueText?.trim();

  elements.push(
    textEl(footerX, footerY, input.orderNo.trim() || "-", FOOTER_SIZE, "B", {
      width: footerW,
      lines: 1,
      align: "C",
    }),
    textEl(footerX, footerY + 32, due ? `Due ${due}` : "Due -", FOOTER_SIZE, "M", {
      width: footerW,
      lines: 2,
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

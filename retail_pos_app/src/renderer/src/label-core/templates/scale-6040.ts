/**
 * 60 × 40 scale label — the weighed-item price label, on **pre-printed stock**.
 *
 * The store buys this 60 × 40 web with a red grid already printed on it: the
 * captions (`PACKED ON`, `USE BY`, `NET kg`, `$/kg`, `PRICE`, the `$` sign in
 * front of the total) and the two horizontal rules are part of the label, not
 * part of this job. So this template prints *values only*, dropped into the
 * cells of somebody else's artwork. Nothing here draws a caption or a rule that
 * the stock already carries — printing one would double it.
 *
 * The coordinates are the hand-written ZPL the owner put on real stock on
 * 2026-08-26 and confirmed against the grid:
 *
 *   docs/label-mockups/6040-pre-1d.zpl   (EAN-13 — CONFIRMED on hardware)
 *   docs/label-mockups/6040-pre-2d.zpl   (PP QR — same geometry, symbol swapped)
 *
 * Read those two files before changing a number here, and print the change.
 *
 * The grid, in dots at 203 dpi (the numbers the constants below are named for):
 *
 *   top red rule ......... y ≈ 67          bottom red rule ...... y ≈ 229
 *   symbol zone .......... x 15–243,  y 67–229
 *   PACKED ON cell ....... x 245–322 ┐ caption band y 80–102,
 *   USE BY cell .......... x 322–392 ┤ values printed at y 106
 *   NET kg cell .......... x 392–470 ┘
 *   $/kg cell ............ x 248–343, y 102–207
 *   PRICE cell ........... x 356–470, y 142–211  ("$" pre-printed at x ≈ 347)
 *   footer zone .......... y 229–320
 *
 * Suppliers reprint the web slightly out of registration, so the values are
 * centred in their cells with the mockup's margins rather than pushed against a
 * cell edge. Do not tighten them to "use the space".
 *
 * The 1D and 2D variants are the *same* layout: the pre-printed grid fixes every
 * cell, and only the symbol in the left zone changes. That is why there is one
 * layout function here where the pre-grid version had two.
 *
 * Input is still mostly formatted strings — this library knows nothing about
 * cents or `momentAU`. Dates are the exception: they arrive as ISO
 * (`YYYY-MM-DD`) because *how* they are rendered is a layout decision (see
 * `formatScaleDates`), not a caller decision.
 */

import { fitSize, textWidth } from "../measure";
import { strike, type Element, type Label, type Line, type Text } from "../model";

/** Every template takes these; nothing here is layout. */
export interface TemplateOptions {
  /** Outline every element — coordinate tuning aid, off by default. */
  dbg?: boolean;
  /** Copies of the label. */
  copies?: number;
}

/** EAN-13 carrying an embedded price: 12 digits, the printer adds the check. */
export interface ScaleBarcodeEan13 {
  kind: "ean13";
  data12: string;
}

/** A prepacked (PP) payload in a QR — built by the caller, opaque here. */
export interface ScaleBarcodePP {
  kind: "pp";
  qrData: string;
}

export type ScaleBarcode = ScaleBarcodeEan13 | ScaleBarcodePP;

export interface ScaleLabelInput {
  nameKo: string;
  nameEn: string;
  /** ISO `YYYY-MM-DD`. The template decides whether the year is shown. */
  packedOnIso: string;
  usedByIso: string;
  /** The number only — the pre-printed cell says `NET kg`. */
  weightText: string;
  /** `kg`, `ea`, `100g` … not printed on this label (the stock says `$/kg`); the
   * 58 × 100 template, which shares this input, does print and correct it. */
  unit: string;
  unitPriceText: string;
  wasUnitPriceText?: string | null;
  /** The `$` is pre-printed beside the PRICE cell, so a leading `$` is stripped. */
  totalText: string;
  /**
   * Struck-through total. The 60 × 40 grid has no cell for it — every box is
   * spoken for by the pre-printed artwork — so it is carried here for the
   * 58 × 100 template, which shares this input and does have the room.
   */
  wasTotalText?: string | null;
  barcode: ScaleBarcode;
  storeName?: string | null;
  storeAddress?: string | null;
}

const MEDIA_W = 480;

// ── name, above the top red rule (y 67) ─────────────────────────────────────
// Two lines, not one joined string: the Korean name is the one a customer
// reads, so it gets the Bold 30 line of its own and the English sits under it.
const NAME_X = 18;
const NAME_W = 450;
const NAME_KO_Y = 4;
const NAME_KO_SIZE = 30;
const NAME_EN_Y = 36;
const NAME_EN_SIZE = 24;

// ── header value row (PACKED ON / USE BY / NET kg) ──────────────────────────
// The caption band is y 80–102 on the stock; values sit just under it. The
// packed-on block starts 17 dots left of its cell because the cell's caption is
// the widest of the three and its box is drawn narrow — the mockup's choice,
// printed and confirmed.
const HEADER_VALUE_Y = 106;
const PACKED_X = 228;
const PACKED_W = 90;
const USED_BY_X = 322;
const USED_BY_W = 70;
const DATE_SIZE = 24;
/** Below this a date is unreadable at arm's length; clipping beats illegible. */
const DATE_MIN_SIZE = 14;
const WEIGHT_X = 394;
const WEIGHT_W = 76;
const WEIGHT_SIZE = 24;

// ── $/kg cell (x 248–343, y 102–207) ────────────────────────────────────────
const UNIT_PRICE_X = 250;
const UNIT_PRICE_Y = 142;
const UNIT_PRICE_W = 92;
const UNIT_PRICE_SIZE = 30;
const WAS_X = 252;
const WAS_Y = 180;
const WAS_W = 88;
const WAS_SIZE = 18;

// ── PRICE cell (x 356–470, y 142–211) ───────────────────────────────────────
// Right-aligned: the pre-printed `$` sits at x ≈ 347 and the amount grows left
// from the cell's right edge, so a three-digit total still reads as `$123.45`.
const TOTAL_X = 356;
const TOTAL_Y = 150;
const TOTAL_W = 114;
const TOTAL_SIZE = 44;

// ── symbol zone (x 15–243, y 67–229) ────────────────────────────────────────
// Two anchors, not one: the EAN is 190 dots wide and the QR 87, so each is
// placed to sit centred in the zone rather than sharing a left edge.
const EAN_X = 34;
const EAN_Y = 80;
const EAN_H = 90;
const EAN_MODULE = 2;
const QR_X = 60;
const QR_Y = 80;
const QR_MAG = 3;

// ── footer zone (below the bottom red rule at y 229) ────────────────────────
const FOOTER_NAME_Y = 238;
const FOOTER_NAME_SIZE = 30;
const FOOTER_ADDR_Y = 276;
const FOOTER_ADDR_SIZE = 18;

/** Text-element shorthand — the block options are the part that varies. */
export type TextBlock = Omit<Partial<Text>, "kind" | "x" | "y" | "text" | "size" | "weight">;

export function textEl(
  x: number,
  y: number,
  text: string,
  size: number,
  weight: "M" | "B" | "BK",
  extra: TextBlock = {},
): Text {
  return { kind: "text", x, y, text, size, weight, ...extra };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface IsoParts {
  year: string;
  month: string;
  day: string;
}

function parseIso(iso: string | null | undefined): IsoParts | null {
  const m = ISO_DATE.exec((iso ?? "").trim());
  return m ? { year: m[1], month: m[2], day: m[3] } : null;
}

/**
 * `2026-08-26` → `26/08`, or `26/08/26` when the year is asked for.
 *
 * Anything that is not an ISO date passes through verbatim: a caller that
 * hands this a display string it formatted itself gets that string printed
 * rather than an empty cell, which is the failure mode that matters on a food
 * label.
 */
export function formatDmy(iso: string | null | undefined, withYear: boolean): string {
  const p = parseIso(iso);
  if (!p) return (iso ?? "").trim();
  return withYear ? `${p.day}/${p.month}/${p.year.slice(2)}` : `${p.day}/${p.month}`;
}

export interface ScaleDates {
  packed: string;
  usedBy: string;
  /** The one size both dates print at, so the row reads as a row. */
  size: number;
}

/**
 * The two dates and the size they both print at.
 *
 * The pre-printed cells are narrow (90 and 70 dots) and `DD/MM/YY` does not fit
 * either of them at the 24 the grid was drawn for. Almost every label is packed
 * and used inside one year, so the common case drops the year and keeps the big
 * type: **same year → `DD/MM` at 24**. When the two dates straddle a New Year —
 * packed 31/12, used by 01/01 — dropping the year would print two dates that
 * look out of order, so **both** gain the year and both shrink to whatever fits
 * the *narrower* of the two cells. One size for both, never one big and one
 * small.
 *
 * The size is measured here rather than left to the emitter's `shrink`, which
 * would fit each field to its own width and give the row two different sizes.
 */
export function formatScaleDates(packedOnIso: string, usedByIso: string): ScaleDates {
  const a = parseIso(packedOnIso);
  const b = parseIso(usedByIso);
  const sameYear = a !== null && b !== null && a.year === b.year;

  const packed = formatDmy(packedOnIso, !sameYear);
  const usedBy = formatDmy(usedByIso, !sameYear);

  const size = Math.min(
    fitSize(packed, PACKED_W, DATE_SIZE, DATE_MIN_SIZE),
    fitSize(usedBy, USED_BY_W, DATE_SIZE, DATE_MIN_SIZE),
  );

  return { packed, usedBy, size };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * The amount without its dollar sign.
 *
 * The PRICE cell has `$` pre-printed to its left, so printing one again gives
 * `$$28.16`. Callers keep passing money as display strings (`$28.16`) because
 * the 58 × 100 label wants them that way, so the sign is stripped here rather
 * than demanded of the caller.
 */
function amountOnly(text: string): string {
  return text.trim().replace(/^(-?)\$/, "$1");
}

/**
 * The rule through the was-price.
 *
 * Centred on the cell and as wide as the text measures, clamped to the cell:
 * the was-price is a caller string that can be four characters or eight, and a
 * rule fixed at the mockup's hand-drawn width would fall short of a longer one.
 * Half a cell down is what puts it through the digits rather than under them —
 * the same convention the 58 × 100 template uses.
 */
function wasRule(text: string): Line {
  const w = Math.min(WAS_W, textWidth(text, WAS_SIZE));
  const x = WAS_X + Math.round((WAS_W - w) / 2);
  return strike(x, WAS_Y + Math.round(WAS_SIZE / 2), w);
}

function symbol(barcode: ScaleBarcode): Element {
  return barcode.kind === "ean13"
    ? {
        kind: "barcode",
        sym: "ean13",
        x: EAN_X,
        y: EAN_Y,
        h: EAN_H,
        module: EAN_MODULE,
        hri: true,
        data: barcode.data12,
      }
    : { kind: "qr", x: QR_X, y: QR_Y, mag: QR_MAG, ec: "M", data: barcode.qrData };
}

function footer(input: ScaleLabelInput): Element[] {
  const out: Element[] = [];
  if (input.storeName) {
    out.push(
      textEl(0, FOOTER_NAME_Y, input.storeName, FOOTER_NAME_SIZE, "BK", {
        width: MEDIA_W,
        lines: 1,
        align: "C",
      }),
    );
  }
  if (input.storeAddress) {
    out.push(
      textEl(0, FOOTER_ADDR_Y, input.storeAddress, FOOTER_ADDR_SIZE, "M", {
        width: MEDIA_W,
        lines: 1,
        align: "C",
      }),
    );
  }
  return out;
}

export function buildScaleLabel6040(
  input: ScaleLabelInput,
  opts: TemplateOptions = {},
): Label {
  const dates = formatScaleDates(input.packedOnIso, input.usedByIso);

  const elements: Element[] = [
    textEl(NAME_X, NAME_KO_Y, input.nameKo.trim(), NAME_KO_SIZE, "B", {
      width: NAME_W,
      lines: 1,
      align: "L",
    }),
    textEl(NAME_X, NAME_EN_Y, input.nameEn.trim(), NAME_EN_SIZE, "M", {
      width: NAME_W,
      lines: 1,
      align: "L",
    }),
    textEl(PACKED_X, HEADER_VALUE_Y, dates.packed, dates.size, "B", {
      width: PACKED_W,
      lines: 1,
      align: "C",
    }),
    textEl(USED_BY_X, HEADER_VALUE_Y, dates.usedBy, dates.size, "B", {
      width: USED_BY_W,
      lines: 1,
      align: "C",
    }),
    textEl(WEIGHT_X, HEADER_VALUE_Y, input.weightText, WEIGHT_SIZE, "B", {
      width: WEIGHT_W,
      lines: 1,
      align: "C",
    }),
    textEl(UNIT_PRICE_X, UNIT_PRICE_Y, input.unitPriceText, UNIT_PRICE_SIZE, "B", {
      width: UNIT_PRICE_W,
      lines: 1,
      align: "C",
    }),
  ];

  if (input.wasUnitPriceText) {
    elements.push(
      textEl(WAS_X, WAS_Y, `was ${input.wasUnitPriceText}`, WAS_SIZE, "M", {
        width: WAS_W,
        lines: 1,
        align: "C",
      }),
      wasRule(`was ${input.wasUnitPriceText}`),
    );
  }

  elements.push(
    textEl(TOTAL_X, TOTAL_Y, amountOnly(input.totalText), TOTAL_SIZE, "BK", {
      width: TOTAL_W,
      lines: 1,
      align: "R",
    }),
    symbol(input.barcode),
    ...footer(input),
  );

  return {
    media: "6040",
    elements,
    dbg: opts.dbg ?? false,
    ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
  };
}

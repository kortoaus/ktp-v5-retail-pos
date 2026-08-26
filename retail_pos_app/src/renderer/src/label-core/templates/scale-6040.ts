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
 * Both files carry the 2026-08-26 revision: the EAN-13 dropped 10 dots to y 90,
 * and the QR line became `^FT54,205^BQN,2,2^FH^FDLA,{payload}^FS` — typeset
 * from its bottom-left corner, magnification 2, automatic input mode, and no
 * ^BQ error-correction parameter at all. Every one of those four was arrived at
 * by scanning real output on a Zebra ZD421, not by reading the manual; the why
 * of each is in `../model`'s `QrAnchor` and in the `qr` case of `../zpl`. Do
 * not "tidy" any of them.
 *
 * Both files also carry the name-band revision made the same day: the band is
 * **one centred English line**, not a Korean line over an English one. See
 * `layoutName6040`.
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
import { layoutNameBand, type NameBandLayout } from "../name-band";
import { uomOverride } from "../uom-override";

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

/**
 * One symbol per label, never two.
 *
 * A stacked QR-over-EAN variant was built and rejected on 2026-08-26: the zone
 * is 162 dots tall, and splitting it gives a QR that a phone struggles with and
 * an EAN too short to scan reliably. If a lane cannot read the PP QR, that lane
 * gets the 1D label — the choice is made per print job, not per symbol.
 */
export type ScaleBarcode = ScaleBarcodeEan13 | ScaleBarcodePP;

export interface ScaleLabelInput {
  /**
   * Korean name. **Not printed by the 60 × 40 template** — it is here because
   * the 58 × 100 ingredient label shares this input and does print it.
   */
  nameKo: string;
  /**
   * English name, and the only name the 60 × 40 label shows.
   *
   * Printed verbatim. Any prefix the legacy scale convention puts in front of
   * it (`[30% OFF] `, `[$1.00 OFF] `) is the caller's to prepend — this
   * template neither builds nor strips one, it only measures what it is given.
   */
  nameEn: string;
  /** ISO `YYYY-MM-DD`. The template decides whether the year is shown. */
  packedOnIso: string;
  usedByIso: string;
  /**
   * The NET cell's contents, printed verbatim.
   *
   * Free text, and the template appends nothing to it. A weighed item passes
   * the number alone (`0.512`) because the pre-printed cell already says
   * `NET kg`; a non-weighed one passes its own unit with it (`1 EA`), which is
   * the case that makes appending `unit` here wrong.
   */
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

// ── name band, above the top red rule (y 67) ────────────────────────────────
// **English only, centred.** The Korean name is not printed on this label at
// all (owner decision, 2026-08-26): the band is 67 dots tall, a Korean line and
// an English line both fit only at 30/24, and the customer this label is for
// reads the English. `nameKo` stays on `ScaleLabelInput` because the 58 × 100
// template shares the type and does print it — here it is deliberately ignored.
//
// One line at 30 whenever the name fits; two at 24 when it does not. See
// `layoutName6040` for the rule and for why the band's `y` moves with it.
const NAME_X = 18;
const NAME_W = 450;
/**
 * Fraction of the block a name may measure before it is given a second line.
 *
 * `^FB` wraps at the block width exactly, and `measure.ts` is an approximation
 * fitted to a hardware sample — so a name measuring 449 of 450 is a coin toss
 * between one line and a printer-wrapped second line at the *one-line* size,
 * which overflows the band. 5% held back is what turns that coin toss into a
 * deliberate two-line layout.
 */
const NAME_FIT = 0.95;
const NAME_ONE_LINE_SIZE = 30;
/** Roughly centres a single 30-dot line in the 0–67 band. */
const NAME_ONE_LINE_Y = 14;
const NAME_TWO_LINE_SIZE = 24;
/** Two 24-dot lines are 48 dots; 6 keeps the pair off both edges of the band. */
const NAME_TWO_LINE_Y = 6;
/** Below this the name is unreadable at arm's length. */
const NAME_MIN_SIZE = 20;

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

// ── unit correction, over the pre-printed `$/kg` caption (x ≈ 299–336, y ≈ 207–225)
// The replacement goes to the caption's **left**: the PRICE box starts at x 356
// and there is nothing but artwork between the two. See `uomOverride`.
//
// **Owner-confirmed on hardware (2026-08-26, Zebra .38, red pre-printed stock):**
// grid label + `$/EA` sample printed, rule crosses the caption and the text
// clears the PRICE box. Named constants so the correction is a one-line change.
const UOM_RULE = { x: 297, y: 216, w: 42 };
const UOM_TEXT = { x: 252, y: 206 };
const UOM_SIZE = 18;

// ── symbol zone (x 15–243, y 67–229) ────────────────────────────────────────
// The EAN keeps the confirmed 1D mockup's left edge, x = 34. The QR sits 20
// dots further in at x = 54, which is what centres a 90-dot symbol in the zone
// — it is 100 dots narrower than the EAN, so sharing a left edge would leave it
// visibly hanging off to one side. Owner-confirmed on hardware.
//
// The QR is *bottom*-anchored rather than top-anchored: see `QrAnchor` in
// ../model — Zebra bottom-aligns ^BQ inside a box sized for the magnification's
// largest symbol, so a top-anchored QR's real top edge moves with the payload
// length and a long PP payload grows down through the red rule at y ≈ 229.
// Anchoring the bottom fixes the edge that has to stay clear of the rule.
//
// Magnification 2, not 3: a full PP payload is ~147 bytes, which is QR version 7
// (45 modules) at level L, so mag 2 is 90 dots square and mag 3 would be 135 —
// wider than the zone allows once the payload is real rather than the short
// sample the mag-3 number was picked against.
const EAN_X = 34;
const EAN_Y = 90;
const EAN_H = 90;
const EAN_MODULE = 2;
const QR_X = 54;
const QR_BOTTOM_Y = 205;
const QR_MAG = 2;


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
// Name band
// ---------------------------------------------------------------------------

export type Name6040Layout = NameBandLayout;

/**
 * How the English name is set in the 0–67 band: size, line count, baseline `y`.
 *
 * Three cases, in order:
 *
 *  1. It measures inside 95% of the block at **30** → one line at 30, sitting
 *     at y 14 so it is roughly centred in the band.
 *  2. It does not → **two** lines at 24, moved up to y 6 to make room for the
 *     second one.
 *  3. It does not fit two lines of 24 either → the same two lines, shrunk to
 *     whatever does fit, and never below 20.
 *
 * The rule itself lives in `../name-band` — the 58 × 100 label sets its name the
 * same way at different sizes, and the margin in case (1) has to mean the same
 * thing on both labels. This function is only this band's numbers.
 */
export function layoutName6040(nameEn: string): Name6040Layout {
  return layoutNameBand(nameEn, {
    width: NAME_W,
    fit: NAME_FIT,
    oneLineSize: NAME_ONE_LINE_SIZE,
    twoLineSize: NAME_TWO_LINE_SIZE,
    minSize: NAME_MIN_SIZE,
    yOne: NAME_ONE_LINE_Y,
    yTwo: NAME_TWO_LINE_Y,
  });
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * The amount without its dollar sign.
 *
 * The PRICE cell has `$` pre-printed to its left, so printing one again gives
 * `$$28.16`. Callers keep passing money as display strings (`$28.16`) because
 * that is what the screens already hold, so the sign is stripped here rather
 * than demanded of the caller.
 *
 * Exported for the 58 × 100 template: its stock pre-prints a `$` over *both*
 * money columns, so it strips the sign from the unit price as well.
 */
export function amountOnly(text: string): string {
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

/** The one symbol that fills the zone the pre-printed grid leaves empty. */
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
    : {
        kind: "qr",
        x: QR_X,
        y: QR_BOTTOM_Y,
        mag: QR_MAG,
        anchor: "bottom",
        data: barcode.qrData,
      };
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
  const name = layoutName6040(input.nameEn);

  const elements: Element[] = [
    textEl(NAME_X, name.y, input.nameEn.trim(), name.size, "B", {
      width: NAME_W,
      lines: name.lines,
      align: "C",
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
    ...uomOverride(input.unit, {
      captionRect: UOM_RULE,
      textPos: UOM_TEXT,
      size: UOM_SIZE,
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

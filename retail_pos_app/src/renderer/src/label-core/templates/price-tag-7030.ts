/**
 * 70 × 30 shelf price tag — the small one, price and name only.
 *
 * ## The 110 dots that are not ours
 *
 * The media is 70 mm of web, 560 dots at 203 dpi, and `^PW560^LL240` still says
 * so — that is what the printer feeds and it has not changed. But the stock the
 * store buys carries a **red tear-off arrow pre-printed down the right-hand
 * edge**, and the dashed tear line sits further in than the artwork suggests.
 * A first cut at 480 put the Data Matrix's right edge and the barcode digits
 * *on* the dashes (hardware photo, 2026-08-26), so the usable canvas is
 * `PRINTABLE_W` × 240 = **450 × 240**, and every coordinate below derives from
 * it — move that one constant and the symbol, the names and the footer all
 * follow.
 *
 * Keep the two apart when tuning. `^PW`/`^LL` are media facts; `PRINTABLE_W` is
 * an artwork fact. Widening one does not widen the other.
 *
 * ## Why the layout was redrawn (2026-08-26)
 *
 * The first port carried the old builder's numbers over verbatim: a 61-dot
 * price and four 21-dot rows stacked under it, all inside the left 340 dots.
 * On real stock that reads as a small price floating in a half-empty tag — the
 * name is barely larger than the barcode digits and two thirds of the height is
 * white. The tag now spends the whole 450 × 240:
 *
 *     y   8…104   price       $ 42 raised · dollars 96 Black · 46 raised cents
 *     y  19… 43   /kg 24, raised onto the cents' cap line
 *     y   8… 88   Data Matrix, top-right, x 362…442
 *     y 110…144   Korean name, Bold 34
 *     y 148…172   English name, Medium 24
 *     y 178…198   was-price + promo range (left) · barcode digits (right)
 *
 * The footer used to sit at y 205. It printed clipped along the bottom edge —
 * a 30 mm web does not feed straight enough to trust the last 40 dots — so the
 * whole stack moved up and the price came down 100 → 96 to pay for it.
 *
 * The price is still four separate fields rather than one string — `$` small
 * and raised, dollars huge, cents small and raised, unit raised beside them —
 * because that is how a shelf price reads from two metres away. The old builder
 * advanced between them with hand-tuned constants (40 dots per dollar digit,
 * 25 per cent digit) fitted to the printer's built-in font; with a proportional
 * TTF those are wrong, so every advance is measured instead.
 *
 * Tune the baselines, not the tops (see `topOf`), and re-run
 * `price-tag-7030.test.mjs` — the 450-dot ceiling is asserted, not assumed.
 */

import { clamp, estimateDataMatrixSize, fitSize, textWidth } from "../measure";
import { type Element, type Label } from "../model";
import { textEl, type TemplateOptions } from "./scale-6040";

/** Money reaches this library as integer cents, as everywhere else in the fleet. */
const MONEY_SCALE = 100;

export function formatMoney(cents: number): string {
  return `$${(cents / MONEY_SCALE).toFixed(2)}`;
}

export interface PriceTagInput {
  nameKo: string;
  nameEn: string;
  /** Unit of measure, printed as `/kg`, `/ea`, `/100g` … */
  uom: string;
  /** The price that is actually charged today. */
  priceCents: number;
  /** The shelf price it replaces, when there is a promotion. */
  wasPriceCents?: number | null;
  /** Already formatted, e.g. `26/08 - 27/08`. */
  promoRange?: string | null;
  /** Printed as text and encoded into the Data Matrix. */
  barcode: string;
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

/**
 * Usable width in dots — 450 of the media's 560.
 *
 * The remaining 110 are the pre-printed red tear-off arrow and the dashed tear
 * line in front of it. Exported so the tests can assert the ceiling against the
 * same number the layout uses.
 */
export const PRINTABLE_W = 450;

const MARGIN_X = 8;
/** Left inset for every left-anchored element — owner asked for 10 more than the right margin (2026-08-26). */
const LEFT_X = MARGIN_X + 10;
/** Right-hand limit for anything right-aligned. */
const RIGHT_EDGE = PRINTABLE_W - MARGIN_X;

/**
 * Ascender as a fraction of the cell — the same constant `price-tag-7090.ts`
 * uses, for the same reason: canvas-style baselines are how these layouts are
 * reasoned about, but `^FO` positions the *top* of the character cell.
 */
const ASCENT = 0.8;

function topOf(baseline: number, size: number): number {
  return Math.round(baseline - size * ASCENT);
}

// ---------------------------------------------------------------------------
// The Data Matrix — placed first, because the price is sized against it
// ---------------------------------------------------------------------------

const DATAMATRIX_SIZE = 5;
/** 16 modules a side at this payload length; 80 dots at size 5. */
const DATAMATRIX_SIDE = estimateDataMatrixSize(DATAMATRIX_SIZE);
const DATAMATRIX_X = PRINTABLE_W - MARGIN_X - DATAMATRIX_SIDE;
const DATAMATRIX_Y = 8;

/**
 * Clear space between the end of the price and the symbol.
 *
 * Three modules at size 5. A Data Matrix needs a one-module quiet zone to
 * decode at all; three is what keeps a hand scanner locking on when the
 * neighbouring glyph is a 100-dot digit.
 */
const PRICE_DM_GAP = 16;

/** Everything the price group may occupy, from `MARGIN_X`. */
const PRICE_MAX_W = DATAMATRIX_X - PRICE_DM_GAP - LEFT_X;

// ---------------------------------------------------------------------------
// The price
// ---------------------------------------------------------------------------

/** Baseline of the dollars; with size 96 that puts the cell at y 8…104. */
const PRICE_BASELINE = 85;
const DOLLAR_SIZE = 96;
/** Below this the price stops being a shelf price. Four digits still fit here. */
const MIN_DOLLAR_SIZE = 64;

/** `$` and the cents as fractions of the dollars — the proportion never changes. */
const CURRENCY_RATIO = 0.44;
const CENT_RATIO = 0.48;

const CURRENCY_GAP = 4;
const CENT_GAP = 8;
const UOM_GAP = 6;

/**
 * How far `$` and the cents are lifted off the dollars' baseline.
 *
 * Same idea as 7090's `CENT_LIFT`, a bigger fraction: there the cents ride just
 * clear of the baseline, here they are raised until their cap top sits level
 * with the dollars' cap top (≈ 0.72 em under the dollars' cell top), which is
 * the superscript-cents look a shelf tag wants. `$` takes the same lift, so the
 * two small fields share a baseline.
 */
const CENT_LIFT = 0.32;

const UOM_SIZE = 24;

/**
 * Dots the unit's cell top sits below the cents' cell top.
 *
 * The unit rides on the raised row, not on the dollars' baseline: at the
 * baseline it printed as a lonely `/kg` under a wall of white, which is what
 * made the first cut look half-empty. Top-aligning the two *cells* would leave
 * the smaller cell's ink sitting high, so the drop lines up the two **cap
 * tops** instead — `24 * (ASCENT - CAP) ≈ 2` dots for this size pair.
 */
const UOM_TOP_DROP = 2;

const currencySize = (dollarSize: number): number => Math.round(dollarSize * CURRENCY_RATIO);
const centSize = (dollarSize: number): number => Math.round(dollarSize * CENT_RATIO);

/**
 * `$` `55` `00` `/kg`, laid left to right by measured advance.
 *
 * Splitting on the decimal point is the whole trick; a price that does not look
 * like `$d.cc` (it always does — `formatMoney` made it) falls back to one
 * shrinking field so the tag still prints something readable.
 *
 * The four fields shrink *together*, which is why this is not one `fitSize`
 * call: `fitSize` seeds the search with the largest size the dollars alone
 * could take, and the loop then walks down two dots at a time until the whole
 * measured group — sign, gaps, cents and unit included — clears `PRICE_MAX_W`.
 * A wide price (`$1234.00 /100g`) therefore gets smaller rather than running
 * under the Data Matrix.
 */
function priceFields(priceCents: number, uom: string): Element[] {
  const money = formatMoney(priceCents);
  const match = /^\$(\d+)\.(\d{2})$/.exec(money);
  if (!match) {
    return [
      textEl(LEFT_X, topOf(PRICE_BASELINE, DOLLAR_SIZE), money, DOLLAR_SIZE, "BK", {
        width: PRICE_MAX_W,
        lines: 1,
        align: "L",
        shrink: true,
        minSize: MIN_DOLLAR_SIZE,
      }),
    ];
  }

  const [, dollars, centText] = match;
  const uomText = `/${uom}`;
  const uomW = textWidth(uomText, UOM_SIZE);
  const fixed = CURRENCY_GAP + CENT_GAP + UOM_GAP + uomW;

  const groupWidth = (size: number): number =>
    textWidth("$", currencySize(size)) +
    CURRENCY_GAP +
    textWidth(dollars, size) +
    CENT_GAP +
    textWidth(centText, centSize(size)) +
    UOM_GAP +
    uomW;

  let ds = fitSize(dollars, PRICE_MAX_W - fixed, DOLLAR_SIZE, MIN_DOLLAR_SIZE);
  while (groupWidth(ds) > PRICE_MAX_W && ds > MIN_DOLLAR_SIZE) ds -= 2;
  ds = clamp(ds, MIN_DOLLAR_SIZE, DOLLAR_SIZE);

  const cur = currencySize(ds);
  const cs = centSize(ds);
  const supBaseline = PRICE_BASELINE - Math.round(ds * CENT_LIFT);

  const centsTop = topOf(supBaseline, cs);
  const dollarsX = LEFT_X + textWidth("$", cur) + CURRENCY_GAP;
  const centsX = dollarsX + textWidth(dollars, ds) + CENT_GAP;
  const uomX = centsX + textWidth(centText, cs) + UOM_GAP;

  return [
    textEl(LEFT_X, topOf(supBaseline, cur), "$", cur, "B"),
    textEl(dollarsX, topOf(PRICE_BASELINE, ds), dollars, ds, "BK"),
    textEl(centsX, centsTop, centText, cs, "B"),
    textEl(uomX, centsTop + UOM_TOP_DROP, uomText, UOM_SIZE, "M"),
  ];
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------
//
// One line each, no wrapping. A 30 mm tag has room for exactly two name rows,
// and a name that wraps to two lines pushes the footer off the label; shrinking
// is the trade this tag makes instead. The floors (24 / 18) are the sizes below
// which the row stops being readable at shelf distance — past them the text
// prints slightly clipped, which is the direction of error `measure.ts` chooses
// everywhere.

const NAME_W = PRINTABLE_W - MARGIN_X - LEFT_X;

const NAME_KO_Y = 110;
const NAME_KO_SIZE = 34;
const NAME_KO_MIN = 24;

const NAME_EN_Y = 148;
const NAME_EN_SIZE = 24;
const NAME_EN_MIN = 18;

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
//
// `was $62.00  26/08 - 27/08` on the left, the barcode digits right-aligned on
// the right. The digits are printed unconditionally — they are how staff find
// the item — so the was-price block is bounded to what is left of them rather
// than being allowed to run into them.

/**
 * Top of the footer row — 178, not the 205 the first cut used.
 *
 * At 205 the row's cell ran to y 225 and printed clipped on real stock: the
 * last dots of a 30 mm web are where the feed is least accurate. 178 puts the
 * cell bottom at 198, two dots inside the 200 the hardware photo showed as
 * safe.
 */
const FOOTER_Y = 178;
const FOOTER_SIZE = 20;
const FOOTER_MIN = 14;

const DIGITS_W = 160;
const DIGITS_X = RIGHT_EDGE - DIGITS_W;
const FOOTER_GAP = 12;
const WAS_W = DIGITS_X - FOOTER_GAP - LEFT_X;

/**
 * The was-price line, range included when there is one.
 *
 * Same rule and the same string the first port used: a `wasPriceCents` that is
 * not higher than what is charged is not a promotion, and the range shares the
 * line because there is no room for a second row.
 */
function wasLine(input: PriceTagInput): string | null {
  if (input.wasPriceCents == null || input.wasPriceCents <= input.priceCents) return null;
  const was = `was ${formatMoney(input.wasPriceCents)}`;
  return input.promoRange ? `${was}  ${input.promoRange}` : was;
}

// ---------------------------------------------------------------------------

export function buildPriceTag7030(
  input: PriceTagInput,
  opts: TemplateOptions = {},
): Label {
  const barcodeText = input.barcode.trim() || "-";

  const elements: Element[] = [
    ...priceFields(input.priceCents, input.uom),
    {
      kind: "datamatrix",
      x: DATAMATRIX_X,
      y: DATAMATRIX_Y,
      size: DATAMATRIX_SIZE,
      data: barcodeText,
    },
  ];

  const nameKo = input.nameKo.trim();
  if (nameKo) {
    elements.push(
      textEl(LEFT_X, NAME_KO_Y, nameKo, NAME_KO_SIZE, "B", {
        width: NAME_W,
        lines: 1,
        align: "L",
        shrink: true,
        minSize: NAME_KO_MIN,
      }),
    );
  }

  const nameEn = input.nameEn.trim();
  if (nameEn) {
    elements.push(
      textEl(LEFT_X, NAME_EN_Y, nameEn, NAME_EN_SIZE, "M", {
        width: NAME_W,
        lines: 1,
        align: "L",
        shrink: true,
        minSize: NAME_EN_MIN,
      }),
    );
  }

  const was = wasLine(input);
  if (was) {
    elements.push(
      textEl(LEFT_X, FOOTER_Y, was, FOOTER_SIZE, "M", {
        width: WAS_W,
        lines: 1,
        align: "L",
        shrink: true,
        minSize: FOOTER_MIN,
      }),
    );
  }

  elements.push(
    textEl(DIGITS_X, FOOTER_Y, barcodeText, FOOTER_SIZE, "M", {
      width: DIGITS_W,
      lines: 1,
      align: "R",
      shrink: true,
      minSize: FOOTER_MIN,
    }),
  );

  return {
    media: "7030",
    elements,
    dbg: opts.dbg ?? false,
    ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
  };
}

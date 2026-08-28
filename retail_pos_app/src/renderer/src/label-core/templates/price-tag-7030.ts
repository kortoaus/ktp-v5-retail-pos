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
 *     y 110…196   the name block — up to three 26-dot rows, 30 apart
 *     y 178…198   was-price + promo range (left) · barcode digits (right)
 *
 * The names are **one paragraph at one size**, Korean (Bold) first and English
 * (Medium) continuing after it. Three rows on a plain tag, two when a was-price
 * needs the footer's left half. See "Names" below.
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

import {
  clamp,
  estimateDataMatrixSize,
  fitSize,
  textWidth,
  wrapToWidths,
} from "../measure";
import { type Element, type Label } from "../model";
import { clippedTextEl, textEl, type TemplateOptions } from "./scale-6040";

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
      clippedTextEl(LEFT_X, topOf(PRICE_BASELINE, DOLLAR_SIZE), money, DOLLAR_SIZE, "BK", {
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
// **One block, one size** (owner's rule after the prints of 2026-08-28).
//
// The tag used to set Korean at 30 and English at 27 on a row of its own. On
// real stock that reads as a heading with a caption under it, and the caption
// is the half nobody can use — "the English is meaningless". So the two names
// are now one paragraph: same size, same leading, Korean first and English
// continuing straight after it on whatever rows are left. Weight still tells
// them apart (Bold / Medium); size no longer does.
//
//     row 1   y110…136   424 wide
//     row 2   y140…166   424 wide
//     row 3   y170…196   252 wide — shares the footer band with the digits
//
// Three rows on a plain tag, two when there is a was-price (the footer's left
// half is then spoken for). Row 3's cell overlaps the footer band, so it is
// capped at `WAS_W` and stops before the digits at x282; the cap is derived
// from the geometry rather than hard-coded, so moving the footer moves it.
//
// **No shrinking anywhere in this block.** A uniform size is the whole point,
// and a size that varies with the name is not uniform. Text that does not fit
// its rows is cut by `clippedTextEl` and marked `…`, which is also what keeps
// `^FB` from printing the overflow on top of the last row.
//
// Rows are separate elements rather than one `^FB` block because `^FB` gives
// neither of the two things this layout needs: it leads at the font's own
// height (26, not 30) and it has one width for every row. `wrapToWidths` does
// the breaking instead — same wrap model, per-row widths.

const NAME_W = PRINTABLE_W - MARGIN_X - LEFT_X;

const NAME_Y = 110;
/** Every name row, Korean or English, is set at this. */
const NAME_SIZE = 26;
/** Baseline-to-baseline; 4 dots of air under a 26-dot cell. */
const NAME_LH = 30;
/** Rows on a plain tag, and on a tag whose footer carries a was-price. */
const NAME_ROWS = 3;
/** Extra dots the last name row may run into the digit zone (owner-approved). */
const NAME_ROW3_OVERLAP = 72;
const NAME_ROWS_PROMO = 2;

interface NameRow {
  y: number;
  width: number;
}

/**
 * The rows available to the name block, narrowest last.
 *
 * A row that reaches into the footer band cannot use the full width — the
 * barcode digits are printed there unconditionally — so it takes the was-price
 * block instead. With the current numbers that is row 3 and only row 3.
 */
function nameRows(count: number, digitsLeft: number = DIGITS_X): NameRow[] {
  const rows: NameRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const y = NAME_Y + i * NAME_LH;
    const inFooterBand = y + NAME_SIZE > FOOTER_Y && y < FOOTER_Y + FOOTER_SIZE;
    // A footer-band row may run PAST where the right-aligned digits start —
    // the digits sit 8 dots lower, so a little horizontal overlap still reads
    // (owner, 2026-08-28: "겹쳐져도 된다, 다섯 자 더"). +72 dots ≈ five more
    // lower-case characters at 26pt.
    const footerW = Math.min(NAME_W, digitsLeft - 8 - LEFT_X + NAME_ROW3_OVERLAP);
    rows.push({ y, width: inFooterBand ? Math.max(WAS_W, footerW) : NAME_W });
  }
  return rows;
}

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

  const was = wasLine(input);
  const nameKo = input.nameKo.trim();
  const nameEn = input.nameEn.trim();

  // Korean takes the rows it needs, English continues on what is left. If the
  // Korean name fills every row there is no English at all — a name that long
  // has already used the space the translation would have had, and half a
  // translation under it is the thing the owner asked to be rid of.
  const digitsLeft = RIGHT_EDGE - textWidth(barcodeText, FOOTER_SIZE);
  const rows = nameRows(was ? NAME_ROWS_PROMO : NAME_ROWS, digitsLeft);
  const koRows = nameKo ? wrapToWidths(nameKo, NAME_SIZE, rows.map((row) => row.width)) : [];
  const enRows =
    nameEn && koRows.length < rows.length
      ? wrapToWidths(
          nameEn,
          NAME_SIZE,
          rows.slice(koRows.length).map((row) => row.width),
        )
      : [];

  const nameRow = (row: NameRow, text: string, weight: "B" | "M"): void => {
    elements.push(
      clippedTextEl(LEFT_X, row.y, text, NAME_SIZE, weight, {
        width: row.width,
        lines: 1,
        align: "L",
      }),
    );
  };

  koRows.forEach((line, i) => nameRow(rows[i], line, "B"));
  enRows.forEach((line, i) => nameRow(rows[koRows.length + i], line, "M"));

  if (was) {
    elements.push(
      clippedTextEl(LEFT_X, FOOTER_Y, was, FOOTER_SIZE, "M", {
        width: WAS_W,
        lines: 1,
        align: "L",
        shrink: true,
        minSize: FOOTER_MIN,
      }),
    );
  }

  elements.push(
    clippedTextEl(DIGITS_X, FOOTER_Y, barcodeText, FOOTER_SIZE, "M", {
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

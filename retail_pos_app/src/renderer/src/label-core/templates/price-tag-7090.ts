/**
 * 70 × 90 shelf price tag — the big one, four layouts behind one entry point.
 *
 * Ported from `libs/label-7090-v2/` (`price-model.ts` for the branching,
 * `render.ts` for the coordinates), which rendered to a canvas and shipped the
 * result as a `^GFA` bitmap. Same tag, drawn with printer commands instead:
 * a quarter of the bytes, no DOM, and text that stays crisp because the printer
 * rasterises it at its own resolution.
 *
 * Two things had to change in the port, both recorded because they are visible:
 *
 *   - **Baselines became tops.** Canvas `fillText` positions a glyph by its
 *     alphabetic baseline; ZPL `^FO` positions the top of the character cell.
 *     Every y in `render.ts` is therefore carried here as a baseline and
 *     converted through `topOf()`, which is what keeps the printed tag looking
 *     like the tag the canvas drew. Tune the baselines, not the tops.
 *   - **The dotted divider is a solid hairline.** The canvas drew 32 filled
 *     circles; reproducing that in ZPL is 32 `^GB` fields for a rule nobody
 *     looks at, so it is one 1-dot line at the same y.
 *
 * The four cases are named after what the shopper sees, not after the data:
 * `normal-guest` is one big price, `normal-member` adds a member price under a
 * small guest line, and the two `promo-*` cases add the was-price, the saving
 * and the promotion dates.
 */

import { ASCENT, FIT_SAFETY, textEm, textWidth } from "../measure";
import { type Element, type Label, type Text } from "../model";
import { clippedTextEl, textEl, type TemplateOptions } from "./scale-6040";
import { formatMoney, type PriceTagInput } from "./price-tag-7030";

export type PriceTag7090Case =
  | "normal-guest"
  | "normal-member"
  | "promo-guest"
  | "promo-member";

/** `current` prints today's promotion; `normal` prints the shelf price regardless. */
export type PriceTag7090Mode = "current" | "normal";

export interface PriceTag7090Input extends PriceTagInput {
  /** Only honoured when it actually beats the price a guest pays. */
  memberPriceCents?: number | null;
  /** Headline for a promotion; falls back to `Special`. */
  promoName?: string | null;
  /** Headline for a non-promotional tag; falls back to `Special`. */
  storeName?: string | null;
  mode?: PriceTag7090Mode;
}

const MEDIA_W = 560;
const CENTER_X = MEDIA_W / 2;
const MARGIN_X = 24;
const CONTENT_W = MEDIA_W - MARGIN_X * 2;

/**
 * Baseline → `^FO` top, through the shared `ASCENT` (`../measure`) — one
 * constant for every template, one place to correct it if the real print sits
 * high or low.
 */
function topOf(baseline: number, size: number): number {
  return Math.round(baseline - size * ASCENT);
}

/** Centred block: `^FB` centres inside the block, so the block has to be centred. */
function centred(
  baseline: number,
  text: string,
  size: number,
  minSize: number,
  weight: "M" | "B" | "BK",
  blockW: number,
): Text {
  const x = Math.round(CENTER_X - blockW / 2);
  return clippedTextEl(x, topOf(baseline, size), text, size, weight, {
    width: blockW,
    lines: 1,
    align: "C",
    shrink: true,
    minSize,
  });
}

function left(
  x: number,
  baseline: number,
  text: string,
  size: number,
  weight: "M" | "B" | "BK",
  blockW: number,
  minSize?: number,
): Text {
  return clippedTextEl(x, topOf(baseline, size), text, size, weight, {
    width: blockW,
    lines: 1,
    align: "L",
    ...(minSize ? { shrink: true, minSize } : {}),
  });
}

function formatSave(cents: number): string {
  if (cents <= 0) return "";
  if (cents < 100) return `SAVE ${cents}c`;
  return `SAVE ${formatMoney(cents)}`;
}

// ---------------------------------------------------------------------------
// Which of the four tags this is
// ---------------------------------------------------------------------------

export interface PriceTag7090Model {
  caseName: PriceTag7090Case;
  headline: string;
  /** The shelf price, struck through on a promo tag. */
  baseCents: number;
  guestCents: number;
  memberCents: number | null;
  isPromo: boolean;
}

/**
 * The branching, ported from `price-model.ts`.
 *
 * A member price only exists if it beats what a guest pays — a "member price"
 * equal to the shelf price is worse than no member price, because it tells the
 * shopper the card is worthless. Same rule for a promotion: `wasPriceCents` has
 * to be higher than what is charged, or there is nothing to promote.
 */
export function getPriceTag7090Model(input: PriceTag7090Input): PriceTag7090Model {
  const base = input.wasPriceCents ?? input.priceCents;
  const isPromo =
    input.mode !== "normal" && input.wasPriceCents != null && input.priceCents < base;
  const guestCents = isPromo ? input.priceCents : base;
  const member = input.memberPriceCents;
  const memberCents = member != null && member > 0 && member < guestCents ? member : null;

  const caseName: PriceTag7090Case = isPromo
    ? memberCents !== null
      ? "promo-member"
      : "promo-guest"
    : memberCents !== null
      ? "normal-member"
      : "normal-guest";

  return {
    caseName,
    headline: isPromo
      ? input.promoName?.trim() || "Special"
      : memberCents !== null
        ? "Member Price"
        : input.storeName?.trim() || "Special",
    baseCents: base,
    guestCents,
    memberCents,
    isPromo,
  };
}

// ---------------------------------------------------------------------------
// The price, drawn big
// ---------------------------------------------------------------------------

/** Gap between the dollars and the raised cents, in dots. */
const CENT_GAP = 10;
/** How far the cents are lifted above the baseline, as a fraction of the dollars. */
const CENT_LIFT = 0.16;
/** Smallest the dollars may shrink to before the tag is simply too narrow. */
const MIN_DOLLAR_SIZE = 40;

/**
 * `$62` `00` — big dollars, small raised cents, centred as one unit.
 *
 * Both sizes come down together until the pair fits, so the proportion between
 * them never changes; that proportion is most of what makes the price legible
 * across an aisle.
 */
function splitPrice(
  cents: number,
  centerX: number,
  baseline: number,
  dollarSize: number,
  centSize: number,
  maxWidth: number,
): Element[] {
  const match = /^\$(\d+)\.(\d{2})$/.exec(formatMoney(cents));
  if (!match) {
    return [centred(baseline, formatMoney(cents), dollarSize, MIN_DOLLAR_SIZE, "BK", maxWidth)];
  }

  const dollars = `$${match[1]}`;
  const centText = match[2];
  let ds = dollarSize;
  let cs = centSize;
  let width = textWidth(dollars, ds) + CENT_GAP + textWidth(centText, cs);

  while (width > maxWidth && ds > MIN_DOLLAR_SIZE) {
    ds -= 4;
    cs -= 2;
    width = textWidth(dollars, ds) + CENT_GAP + textWidth(centText, cs);
  }

  const x = Math.round(centerX - width / 2);
  const centX = x + textWidth(dollars, ds) + CENT_GAP;

  return [
    textEl(x, topOf(baseline, ds), dollars, ds, "BK"),
    textEl(centX, topOf(baseline - Math.round(ds * CENT_LIFT), cs), centText, cs, "BK"),
  ];
}

// ---------------------------------------------------------------------------
// Shared rows
// ---------------------------------------------------------------------------

function uomLine(baseline: number, uom: string, size: number, minSize: number): Text {
  return centred(baseline, `/${uom}`, size, minSize, "B", 160);
}

function guestCompactLine(model: PriceTag7090Model, uom: string, baseline: number): Text {
  return centred(
    baseline,
    `GUEST ${formatMoney(model.guestCents)} /${uom}`,
    MEMBER_GUEST_SIZE,
    24,
    "BK",
    500,
  );
}

function memberCaption(baseline: number): Text {
  return centred(baseline, "MEMBER", MEMBER_CAPTION_SIZE, 24, "BK", 300);
}

// ---------------------------------------------------------------------------
// The member stack
// ---------------------------------------------------------------------------
//
// `GUEST $62.00 /kg`, `MEMBER`, and the member price are read as one column, so
// they are laid out as one — the two `*-member` cases share every constant below
// and differ only in what hangs underneath the price.
//
// Hardware, ZD421, 2026-08-26: the first cut set these baselines at 226 / 270 /
// 374 with the price at 132–136, which puts `MEMBER`'s cell (244…276) *inside*
// the price's cell (265…401) and leaves GUEST 11 dots off MEMBER. In print that
// reads as `MEMBER` sitting on top of the `$`, because the `$` overshoots the
// cap height that `ASCENT` assumes. Rather than guess at the overshoot, the
// rhythm is now set on the `elementBounds` cell boxes with real clearance:
//
//     GUEST   188…222   (34)
//               +16          ≥ 14
//     MEMBER  238…270   (32)
//               +20          ≥ 18
//     price   290…410  (120)
//
// The 26 dots that buys come from the price (136/132 → 120), from the dead space
// under the 2-dot rule at y176, and — on the promo tag only — from a compressed
// footer. Everything below the price still sits inside the price cell's bottom
// fifth, which is descender space no digit and no `$` reaches.
//
// Tune the baselines, not the tops, and re-run `price-tag-7090.test.mjs` after:
// the separation is asserted, not assumed.

/** Baseline of `GUEST $x.xx /uom`. */
const MEMBER_GUEST_BASELINE = 215;
const MEMBER_GUEST_SIZE = 34;
/** Baseline of the `MEMBER` caption. */
const MEMBER_CAPTION_BASELINE = 264;
const MEMBER_CAPTION_SIZE = 32;
/** Baseline of the big member price. */
const MEMBER_PRICE_BASELINE = 386;
/** Down from 136/132 — see the clearance table above. */
const MEMBER_PRICE_SIZE = 120;
/** Raised cents, held at the ~0.56 proportion the guest tags use. */
const MEMBER_CENT_SIZE = 68;

function saveLine(cents: number, baseline: number, size: number = 30): Element[] {
  const text = formatSave(cents);
  return text ? [left(330, baseline, text, size, "BK", 205, 22)] : [];
}

/**
 * Sizes for the promo footer.
 *
 * Defaults are the `promo-guest` figures, which is the layout with room to
 * spare. `promo-member` spends most of its height on the member stack above and
 * passes a compressed set — see `MEMBER_*` below for why.
 */
interface PromoMetaSizes {
  was?: number;
  save?: number;
  range?: number;
  /** Baseline distance from the was/save row down to the date range. */
  rangeGap?: number;
}

/** `Was $6.50`, the saving, and the promotion dates — the promo footer block. */
function promoMeta(
  model: PriceTag7090Model,
  promoRange: string | null | undefined,
  baseline: number,
  sizes: PromoMetaSizes = {},
): Element[] {
  const wasSize = sizes.was ?? 28;
  const saveSize = sizes.save ?? 30;
  const rangeSize = sizes.range ?? 23;
  const rangeGap = sizes.rangeGap ?? 34;

  const savedCents =
    model.memberCents !== null
      ? model.baseCents - model.memberCents
      : model.baseCents - model.guestCents;

  return [
    left(MARGIN_X, baseline, `Was ${formatMoney(model.baseCents)}`, wasSize, "M", 190),
    ...saveLine(savedCents, baseline, saveSize),
    ...(promoRange
      ? [left(MARGIN_X, baseline + rangeGap, promoRange, rangeSize, "M", 300)]
      : []),
  ];
}

/** The dotted rule of the canvas version, as one hairline. */
function divider(y: number): Element {
  return { kind: "line", x: MARGIN_X, y, w: CONTENT_W, h: 1, thick: 1 };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------
//
// ## Rows, placed by the template (hotfix v1.8.9, platform F-37)
//
// The names are set **one single-line element per row**, broken here, not
// handed to the printer as one multi-line `^FB` block. Until v1.8.8 the Korean
// name was one 430 × 2 block cut by `clipToBlock` on the estimator's own wrap —
// but `measure.ts` counts hangul at a full em and the printer sets it about
// 15 % narrower, so the printer filled line 1 further than the estimate, and a
// cut made for the estimated second line left the printed one half empty
// (`[쭈꾸뿅] 쭈꾸뿅 양념쭈꾸미` / `순한맛 30…`, owner photo 2026-11-15). With one
// element per row the printed rows are the rows the cut was computed on: an
// early break only moves a word down a row, it never loses text.
//
// The rule, derived from the geometry rather than tabled per case:
//
//   - **Korean**: up to 2 rows at 40, baseline pitch 42.
//   - **English**: after the Korean, at 27 shrinking toward 20, on 1 row — or
//     on 2 when the second row's cell (at 27) still ends at or above the top of
//     the bottom digit line, y638. As before, a shrunk row keeps the top of the
//     27-dot cell, so shrinking only lifts the rows. That gives a second row on
//     `normal-guest` always and on the other three only after a one-row Korean
//     name; after two
//     Korean rows on `promo-*` / `*-member` English stays one row, as the
//     owner's rule of 2026-08-28 had it ("Korean up to 2 lines plus English 1",
//     set for the 122-dot zone of the tallest layouts; the second English row
//     where there is room is the owner's 2026-11-15 amendment).
//   - **Width per row**: the full content width (512, x24…536) when the row's
//     cell ends `NAME_ROW_GAP` above the Data Matrix (y608); 430 — clear of the
//     Data Matrix at x475 — for a row that reaches lower. Only English rows
//     ever do (the lowest Korean cell ends at y598).
//   - **Cut**: only the last allowed row, only when the text does not fit the
//     rows it has, with `…`. A word wider than a whole row is broken between
//     characters rather than cut while a row is still free.
//
// English fits its rows with `FIT_SAFETY`, as its one-row shrink always did —
// the Latin ratios run slightly narrow (hardware, 2026-08-28) and a single-line
// `^FB` prints an overrun on top of itself. Korean breaks on the plain measure,
// as `estimateLines` did: hangul is measured wide, not narrow.
//
// ## Hardware history kept from the `^FB` block
//
// `NAME_KO_LH` is 42, down from the 46 the first cut used, and that four dots
// is exactly what the busiest case needed: at 46 a two-line Korean name put the
// English cell at y618…645, seven dots *into* the digit line. At 42 it lands at
// y610…637 — one dot clear, and the clearance is exact, not statistical, since
// both cells are emitted at absolute coordinates. 43 does not fit; this is the
// smallest tightening that works. Asserted in `price-tag-7090.test.mjs`.

/** Content width: a name row with nothing beside it. */
const NAME_FULL_W = CONTENT_W;
/** A name row level with the Data Matrix: x24 + 430 = 454, clear of x475. */
const NAME_W = 430;
const NAME_KO_SIZE = 40;
/** Baseline pitch of the Korean rows. See the note above before raising it. */
const NAME_KO_LH = 42;
const NAME_KO_ROWS = 2;
const NAME_EN_SIZE = 27;
/** English shrinks no further than this; past it the last row is cut. */
const NAME_EN_MIN = 20;
const NAME_EN_ROWS = 2;
/** Air between two name cells — the Korean pitch less its size. */
const NAME_ROW_GAP = NAME_KO_LH - NAME_KO_SIZE;

const DATAMATRIX_X = 475;
const DATAMATRIX_Y = 608;
const DATAMATRIX_SIZE = 5;
const DIGITS_BASELINE = 654;
const DIGITS_SIZE = 20;
/** Top of the bottom digit line's cell (y638) — no name cell goes below it. */
const DIGITS_TOP = topOf(DIGITS_BASELINE, DIGITS_SIZE);

interface NameRow {
  /** `^FO` top of the row's cell. */
  top: number;
  width: number;
}

/** How wide a row may run at its own height — see the rule above. */
function nameRow(top: number, size: number): NameRow {
  const clearOfMatrix = top + size + NAME_ROW_GAP <= DATAMATRIX_Y;
  return { top, width: clearOfMatrix ? NAME_FULL_W : NAME_W };
}

/**
 * `text` broken onto rows whose budgets (in dots) are `budgets`.
 *
 * The `wrapToWidths` model (`../measure`): break on spaces where the string has
 * any and between characters otherwise, and keep whatever is left over on the
 * last row so the caller can cut it visibly. One addition: a token wider than a
 * whole row is broken between characters, starting on the row it reaches,
 * instead of being left to overrun a row and be cut while rows remain.
 */
function wrapRows(text: string, size: number, budgets: number[]): string[] {
  const bySpace = text.includes(" ");
  const tokens = bySpace ? text.split(/\s+/).filter(Boolean) : Array.from(text);
  const glue = bySpace ? " " : "";
  const fits = (candidate: string, row: number): boolean =>
    textEm(candidate) * size <= budgets[row];

  const rows: string[] = [];
  let row = "";

  for (const token of tokens) {
    let rest = token;
    while (rest) {
      const i = rows.length;
      const next = row ? row + glue + rest : rest;
      if (i === budgets.length - 1 || fits(next, i)) {
        row = next;
        break;
      }
      if (row && fits(rest, i + 1)) {
        // An ordinary word wrap: the token starts the next row.
        rows.push(row);
        row = "";
        continue;
      }
      // Wider than a whole row: fill this row with as much of it as fits.
      const chars = Array.from(rest);
      const head = row ? row + glue : "";
      let keep = 0;
      while (keep < chars.length && fits(head + chars.slice(0, keep + 1).join(""), i)) {
        keep += 1;
      }
      if (keep === 0 && !row) keep = 1;
      rows.push(keep > 0 ? head + chars.slice(0, keep).join("") : row);
      row = "";
      rest = chars.slice(keep).join("");
    }
  }
  if (row) rows.push(row);
  return rows;
}

/** One single-line element per row; `clippedTextEl` cuts the last one if it overruns. */
function rowElements(lines: string[], rows: NameRow[], size: number): Element[] {
  return lines.map((line, i) =>
    clippedTextEl(MARGIN_X, rows[i].top, line, size, "B", {
      width: rows[i].width,
      lines: 1,
      align: "L",
    }),
  );
}

/**
 * The English rows at `size`. Row 1 keeps the top of the 27-dot cell whatever
 * the size (as the one shrinking field of v1.8.8 did); the next row follows one
 * cell plus `NAME_ROW_GAP` below.
 */
function englishRows(top: number, size: number, count: number): NameRow[] {
  return Array.from({ length: count }, (_, i) =>
    nameRow(top + i * (size + NAME_ROW_GAP), size),
  );
}

function names(input: PriceTag7090Input, baseline: number): Element[] {
  const out: Element[] = [];
  const ko = input.nameKo.trim();
  const en = input.nameEn.trim();
  let cursor = baseline;

  if (ko) {
    const rows = Array.from({ length: NAME_KO_ROWS }, (_, i) =>
      nameRow(topOf(cursor + i * NAME_KO_LH, NAME_KO_SIZE), NAME_KO_SIZE),
    );
    const lines = wrapRows(
      ko,
      NAME_KO_SIZE,
      rows.map((row) => row.width),
    );
    out.push(...rowElements(lines, rows, NAME_KO_SIZE));
    cursor += lines.length * NAME_KO_LH;
  }

  if (en) {
    const top = topOf(cursor, NAME_EN_SIZE);
    // How many rows the layout has for English is decided at full size; a
    // smaller size only pulls the second row up, never down past y638.
    let count = 1;
    while (
      count < NAME_EN_ROWS &&
      englishRows(top, NAME_EN_SIZE, count + 1).every(
        (row) => row.top + NAME_EN_SIZE <= DIGITS_TOP,
      )
    ) {
      count += 1;
    }

    for (let size = NAME_EN_SIZE; size >= NAME_EN_MIN; size -= 1) {
      const rows = englishRows(top, size, count);
      const budgets = rows.map((row) => row.width * FIT_SAFETY);
      const lines = wrapRows(en, size, budgets);
      const last = lines.length - 1;
      if (size === NAME_EN_MIN || textEm(lines[last]) * size <= budgets[last]) {
        out.push(...rowElements(lines, rows, size));
        break;
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------

export function buildPriceTag7090(
  input: PriceTag7090Input,
  opts: TemplateOptions = {},
): Label {
  const model = getPriceTag7090Model(input);
  const barcodeText = input.barcode.trim() || "-";
  const elements: Element[] = [
    left(MARGIN_X, 48, barcodeText, 22, "B", 240),
    centred(
      model.isPromo ? 110 : 128,
      model.headline,
      model.isPromo ? 52 : 62,
      model.isPromo ? 36 : 42,
      "BK",
      500,
    ),
    { kind: "line", x: MARGIN_X, y: 176, w: CONTENT_W, h: 2, thick: 2 },
  ];

  let nameBaseline: number;

  switch (model.caseName) {
    case "normal-guest": {
      elements.push(
        ...splitPrice(model.guestCents, CENTER_X, 335, 156, 86, 510),
        uomLine(382, input.uom, 28, 20),
      );
      nameBaseline = 440;
      break;
    }

    case "normal-member": {
      // No promo footer here, so the rows under the price get real clearance
      // instead of the descender-space tuck the promo tag settles for.
      elements.push(
        guestCompactLine(model, input.uom, MEMBER_GUEST_BASELINE),
        memberCaption(MEMBER_CAPTION_BASELINE),
        ...splitPrice(
          model.memberCents ?? model.guestCents,
          CENTER_X,
          MEMBER_PRICE_BASELINE,
          MEMBER_PRICE_SIZE,
          MEMBER_CENT_SIZE,
          510,
        ),
        uomLine(435, input.uom, 26, 20),
        ...saveLine(model.baseCents - (model.memberCents ?? model.baseCents), 474),
        divider(504),
      );
      nameBaseline = 548;
      break;
    }

    case "promo-guest": {
      elements.push(
        ...splitPrice(model.guestCents, CENTER_X, 334, 146, 82, 510),
        uomLine(380, input.uom, 26, 20),
        ...promoMeta(model, input.promoRange, 420),
        divider(472),
      );
      nameBaseline = 526;
      break;
    }

    case "promo-member": {
      // The busiest of the four: member stack *and* promo footer between the
      // same two rules. The footer is compressed a step (28/30/23 → 26/28/21,
      // and the date row pulled up 34 → 32) to pay for the clearance above.
      elements.push(
        guestCompactLine(model, input.uom, MEMBER_GUEST_BASELINE),
        memberCaption(MEMBER_CAPTION_BASELINE),
        ...splitPrice(
          model.memberCents ?? model.guestCents,
          CENTER_X,
          MEMBER_PRICE_BASELINE,
          MEMBER_PRICE_SIZE,
          MEMBER_CENT_SIZE,
          510,
        ),
        uomLine(424, input.uom, 22, 18),
        ...promoMeta(model, input.promoRange, 458, {
          was: 26,
          save: 28,
          range: 21,
          rangeGap: 32,
        }),
        divider(504),
      );
      nameBaseline = 548;
      break;
    }
  }

  elements.push(
    ...names(input, nameBaseline),
    {
      kind: "datamatrix",
      x: DATAMATRIX_X,
      y: DATAMATRIX_Y,
      size: DATAMATRIX_SIZE,
      data: barcodeText,
    },
    left(MARGIN_X, DIGITS_BASELINE, barcodeText, DIGITS_SIZE, "M", 390),
  );

  return {
    media: "7090",
    elements,
    dbg: opts.dbg ?? false,
    ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
  };
}

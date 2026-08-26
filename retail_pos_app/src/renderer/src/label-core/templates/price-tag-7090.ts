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

import { estimateLines, textWidth } from "../measure";
import { type Element, type Label, type Text } from "../model";
import { textEl, type TemplateOptions } from "./scale-6040";
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
 * Ascender as a fraction of the cell.
 *
 * Noto Sans KR sits its baseline about four fifths of the way down the em box,
 * so this is what turns a canvas baseline into a `^FO` top. One constant, one
 * place to correct it if the real print sits high or low.
 */
const ASCENT = 0.8;

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
  return textEl(x, topOf(baseline, size), text, size, weight, {
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
  return textEl(x, topOf(baseline, size), text, size, weight, {
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
    34,
    24,
    "BK",
    500,
  );
}

function memberCaption(baseline: number): Text {
  return centred(baseline, "MEMBER", 32, 24, "BK", 300);
}

function saveLine(cents: number, baseline: number): Element[] {
  const text = formatSave(cents);
  return text ? [left(330, baseline, text, 30, "BK", 205, 22)] : [];
}

/** `Was $6.50`, the saving, and the promotion dates — the promo footer block. */
function promoMeta(
  model: PriceTag7090Model,
  promoRange: string | null | undefined,
  baseline: number,
): Element[] {
  const savedCents =
    model.memberCents !== null
      ? model.baseCents - model.memberCents
      : model.baseCents - model.guestCents;

  return [
    left(MARGIN_X, baseline, `Was ${formatMoney(model.baseCents)}`, 28, "M", 190),
    ...saveLine(savedCents, baseline),
    ...(promoRange ? [left(MARGIN_X, baseline + 34, promoRange, 23, "M", 300)] : []),
  ];
}

/** The dotted rule of the canvas version, as one hairline. */
function divider(y: number): Element {
  return { kind: "line", x: MARGIN_X, y, w: CONTENT_W, h: 1, thick: 1 };
}

const NAME_W = 430;
const NAME_KO_SIZE = 40;
const NAME_KO_LH = 46;
const NAME_EN_SIZE = 27;
const NAME_MAX_LINES = 2;

function names(input: PriceTag7090Input, baseline: number): Element[] {
  const out: Element[] = [];
  const ko = input.nameKo.trim();
  const en = input.nameEn.trim();
  let cursor = baseline;

  if (ko) {
    const lines = estimateLines(ko, NAME_KO_SIZE, NAME_W, NAME_MAX_LINES);
    out.push(
      textEl(MARGIN_X, topOf(cursor, NAME_KO_SIZE), ko, NAME_KO_SIZE, "B", {
        width: NAME_W,
        lines,
        align: "L",
      }),
    );
    cursor += lines * NAME_KO_LH;
  }

  if (en) {
    out.push(
      textEl(MARGIN_X, topOf(cursor, NAME_EN_SIZE), en, NAME_EN_SIZE, "B", {
        width: NAME_W,
        lines: estimateLines(en, NAME_EN_SIZE, NAME_W, NAME_MAX_LINES),
        align: "L",
      }),
    );
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
      elements.push(
        guestCompactLine(model, input.uom, 226),
        memberCaption(270),
        ...splitPrice(model.memberCents ?? model.guestCents, CENTER_X, 374, 136, 76, 510),
        uomLine(416, input.uom, 26, 20),
        ...saveLine(model.baseCents - (model.memberCents ?? model.baseCents), 454),
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
      elements.push(
        guestCompactLine(model, input.uom, 226),
        memberCaption(270),
        ...splitPrice(model.memberCents ?? model.guestCents, CENTER_X, 374, 132, 74, 510),
        uomLine(416, input.uom, 24, 18),
        ...promoMeta(model, input.promoRange, 454),
        divider(504),
      );
      nameBaseline = 548;
      break;
    }
  }

  elements.push(
    ...names(input, nameBaseline),
    { kind: "datamatrix", x: 475, y: 628, size: 5, data: barcodeText },
    left(MARGIN_X, 684, barcodeText, 20, "M", 390),
  );

  return {
    media: "7090",
    elements,
    dbg: opts.dbg ?? false,
    ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
  };
}

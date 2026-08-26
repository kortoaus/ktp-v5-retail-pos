/**
 * 70 × 30 shelf price tag — the small one, price and name only.
 *
 * Ported from the POS's `libs/label-templates.ts buildPriceTag7030`, with the
 * media corrected: the old builder declared 550 dots for a 70 mm web, which is
 * 560. The ten dots went somewhere invisible, so nothing is moved to
 * compensate.
 *
 * The price is drawn as four separate fields rather than one string —
 * `$` small, dollars huge, `.` small, cents small — because that is how a shelf
 * price reads from two metres away. The old builder advanced between them with
 * hand-tuned constants (40 dots per dollar digit, 25 per cent digit) that were
 * fitted to the printer's built-in font; with a proportional TTF those are
 * wrong, so the advances are measured instead.
 */

import { estimateLines, textWidth } from "../measure";
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

const MEDIA_W = 560;

const CURRENCY_X = 5;
const CURRENCY_Y = 20;
const CURRENCY_SIZE = 41;
const DOLLARS_X = 35;
const DOLLARS_Y = 10;
const DOLLARS_SIZE = 61;
const CENTS_Y = 15;
const CENTS_SIZE = 41;
const UOM_Y = 40;
const UOM_SIZE = 21;
const UOM_GAP = 5;

const ROW_X = 10;
const ROW_Y = 90;
const ROW_SIZE = 21;
const ROW_HEIGHT = 30;
const EN_MAX_LINES = 2;

const DATAMATRIX_X = 350;
const DATAMATRIX_Y = 10;
const DATAMATRIX_SIZE = 4;

/** Text rows stop where the Data Matrix starts. */
const ROW_W = DATAMATRIX_X - ROW_X - 10;

/**
 * `$` `55` `.` `00` `/kg`, laid left to right by measured advance.
 *
 * Splitting on the decimal point is the whole trick; a price that does not look
 * like `$d.cc` (it always does — `formatMoney` made it) falls back to one field
 * so the tag still prints something readable.
 */
function priceFields(priceCents: number, uom: string): Element[] {
  const match = /^\$(\d+)\.(\d{2})$/.exec(formatMoney(priceCents));
  if (!match) {
    return [textEl(CURRENCY_X, DOLLARS_Y, formatMoney(priceCents), DOLLARS_SIZE, "BK")];
  }

  const [, dollars, cents] = match;
  const dotX = DOLLARS_X + textWidth(dollars, DOLLARS_SIZE);
  const centsX = dotX + textWidth(".", CENTS_SIZE);
  const uomX = centsX + textWidth(cents, CENTS_SIZE) + UOM_GAP;

  return [
    textEl(CURRENCY_X, CURRENCY_Y, "$", CURRENCY_SIZE, "B"),
    textEl(DOLLARS_X, DOLLARS_Y, dollars, DOLLARS_SIZE, "BK"),
    textEl(dotX, CENTS_Y, ".", CENTS_SIZE, "B"),
    textEl(centsX, CENTS_Y, cents, CENTS_SIZE, "B"),
    textEl(uomX, UOM_Y, `/${uom}`, UOM_SIZE, "M", {
      width: Math.max(1, MEDIA_W - uomX),
      lines: 1,
      align: "L",
    }),
  ];
}

export function buildPriceTag7030(
  input: PriceTagInput,
  opts: TemplateOptions = {},
): Label {
  const elements: Element[] = [...priceFields(input.priceCents, input.uom)];

  let y = ROW_Y;
  const row = (text: string, weight: "M" | "B", lines: number): void => {
    elements.push(
      textEl(ROW_X, y, text, ROW_SIZE, weight, {
        width: ROW_W,
        lines,
        align: "L",
      }),
    );
    y += ROW_HEIGHT * lines;
  };

  // was-price line: the range is part of the same line when there is one, the
  // way the old tag printed it — there is no room for a second row.
  if (input.wasPriceCents != null && input.wasPriceCents > input.priceCents) {
    const was = `was ${formatMoney(input.wasPriceCents)}`;
    row(input.promoRange ? `${was}  ${input.promoRange}` : was, "M", 1);
  }

  if (input.nameKo.trim()) row(input.nameKo.trim(), "B", 1);

  const nameEn = input.nameEn.trim();
  if (nameEn) {
    row(nameEn, "M", estimateLines(nameEn, ROW_SIZE, ROW_W, EN_MAX_LINES));
  }

  row(input.barcode.trim() || "-", "M", 1);

  elements.push({
    kind: "datamatrix",
    x: DATAMATRIX_X,
    y: DATAMATRIX_Y,
    size: DATAMATRIX_SIZE,
    data: input.barcode.trim() || "-",
  });

  return {
    media: "7030",
    elements,
    dbg: opts.dbg ?? false,
    ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
  };
}

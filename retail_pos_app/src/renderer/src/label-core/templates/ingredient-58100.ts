/**
 * 58 × 100 ingredient label — the tall scale label with a statement panel.
 *
 * The layout is the legacy scale terminal's `ingredientLabelTemplate` /
 * `…TemplateQR` (`ktpv5-scale/libs/labelTemplate.ts`), which has been printing
 * in production for years, moved onto the geometric media size: the original
 * declared 440 × 800 for what is a 58 mm web (464 dots), so every x and y is
 * kept and the extra 24 dots simply appear as right margin. That is deliberate
 * — matching the old label exactly matters more than centring it, and the
 * template step tunes it against real stock afterwards.
 *
 * Three things are not straight ports:
 *
 *   - the old template printed with the printer's built-in font, so weights are
 *     new here: name Bold, ingredients Medium, prices Bold, total Black;
 *   - money and weight fields carry a block width so a long value clips at the
 *     column instead of running into the next one (the old one overran);
 *   - the QR variant narrows the ingredient block to the QR's left edge. The
 *     original drew a QR at 280,300 straight over a full-width ingredient
 *     paragraph — legible only because the paragraphs were short.
 *
 * No store footer: this label's bottom is spoken for by the dates and the
 * symbol, and the statement panel is what the customer reads.
 */

import { fitSize, estimateLines, textWidth } from "../measure";
import { strike, type Element, type Label } from "../model";
import { formatDmy, textEl, type ScaleLabelInput, type TemplateOptions } from "./scale-6040";

export interface IngredientLabelInput extends ScaleLabelInput {
  /** Free text; wrapped by the printer, capped at what fits above the price row. */
  ingredients?: string | null;
}

const MEDIA_W = 464;
const MARGIN = 10;

// Name: three lines of 50, from the legacy y.
const NAME_X = 10;
const NAME_Y = 130;
const NAME_SIZE = 50;
const NAME_MIN_SIZE = 30;
const NAME_LINES = 3;

const INGREDIENT_SIZE = 20;
const INGREDIENT_GAP = 10;

// The price row and everything below it are fixed to the pre-printed stock.
const INFO_Y = 565;
const WEIGHT_X = 20;
const UNIT_PRICE_X = 140;
const TOTAL_X = 270;
const WAS_Y = INFO_Y - 100;
const WAS_SIZE = 40;
const WAS_MIN_SIZE = 24;
const PRICE_SIZE = 50;
const PRICE_MIN_SIZE = 28;
const TOTAL_Y = INFO_Y - 4;
const TOTAL_SIZE = 60;
const TOTAL_MIN_SIZE = 36;

const DATE_Y = 665;
const DATE_SIZE = 30;
const DATE_MIN_SIZE = 18;

const BARCODE_X = 240;
const BARCODE_Y = 638;
const QR_X = 280;
const QR_Y = 300;
const QR_MAG = 3;

/**
 * The rules that cross out the pre-printed `kg` on the stock.
 *
 * The label web is bought pre-printed with a kilogram unit; when the item is
 * priced per 100 g or per each, those two words have to be struck and the real
 * unit written beside the price. Nothing but the unit decides this.
 */
function unitOverrides(unit: string): Element[] {
  if (unit.trim().toUpperCase() === "KG") return [];
  return [
    strike(15, INFO_Y - 43, 25),
    strike(UNIT_PRICE_X, INFO_Y - 43, 30),
    textEl(180, INFO_Y - 58, `$/${unit}`, 20, "M"),
  ];
}

/**
 * A struck-out was-price, sized before it is struck.
 *
 * The rule has to be as long as the text actually prints, so the shrink is
 * resolved here rather than left to the emitter — a field declared at 40 and
 * rendered at 24 would otherwise get a 40-sized rule through it.
 */
function wasBlock(x: number, y: number, text: string, width: number): Element[] {
  const size = fitSize(text, width, WAS_SIZE, WAS_MIN_SIZE);
  return [
    textEl(x, y, text, size, "M", { width, lines: 1, align: "L" }),
    strike(x - 2, y + Math.round(size / 2), Math.min(width, textWidth(text, size))),
  ];
}

export function buildIngredientLabel58100(
  input: IngredientLabelInput,
  opts: TemplateOptions = {},
): Label {
  const isQr = input.barcode.kind === "pp";
  const elements: Element[] = [];

  // ── name ────────────────────────────────────────────────────────────────
  const nameWidth = MEDIA_W - NAME_X - MARGIN;
  const name = `${input.nameKo} ${input.nameEn}`.trim();
  const nameSize = fitSize(name, nameWidth * NAME_LINES, NAME_SIZE, NAME_MIN_SIZE);
  elements.push(
    textEl(NAME_X, NAME_Y, name, NAME_SIZE, "B", {
      width: nameWidth,
      lines: NAME_LINES,
      align: "L",
      shrink: true,
      minSize: NAME_MIN_SIZE,
    }),
  );

  // ── ingredients ─────────────────────────────────────────────────────────
  // The paragraph starts under however many lines the name actually took, the
  // way the old template did, and stops before the price row.
  const nameLines = estimateLines(name, nameSize, nameWidth, NAME_LINES);
  const ingredientY = NAME_Y + Math.max(1, nameLines) * NAME_SIZE + INGREDIENT_GAP;
  const ingredientWidth = (isQr ? QR_X - MARGIN : MEDIA_W - MARGIN) - NAME_X;
  const ingredientLines = Math.max(
    0,
    Math.floor((INFO_Y - MARGIN - ingredientY) / INGREDIENT_SIZE),
  );
  const ingredients = input.ingredients?.trim();
  if (ingredients && ingredientLines > 0) {
    elements.push(
      textEl(NAME_X, ingredientY, ingredients, INGREDIENT_SIZE, "M", {
        width: ingredientWidth,
        lines: ingredientLines,
        align: "L",
      }),
    );
  }

  // ── price row ───────────────────────────────────────────────────────────
  const weightWidth = UNIT_PRICE_X - WEIGHT_X - MARGIN;
  const unitPriceWidth = TOTAL_X - UNIT_PRICE_X - MARGIN;
  const totalWidth = MEDIA_W - TOTAL_X - MARGIN;

  elements.push(
    textEl(WEIGHT_X, INFO_Y, input.weightText, PRICE_SIZE, "B", {
      width: weightWidth,
      lines: 1,
      align: "L",
      shrink: true,
      minSize: PRICE_MIN_SIZE,
    }),
  );

  if (input.wasUnitPriceText) {
    elements.push(
      ...wasBlock(UNIT_PRICE_X, WAS_Y, `was ${input.wasUnitPriceText}`, unitPriceWidth),
    );
  }

  elements.push(
    textEl(UNIT_PRICE_X, INFO_Y, input.unitPriceText, PRICE_SIZE, "B", {
      width: unitPriceWidth,
      lines: 1,
      align: "L",
      shrink: true,
      minSize: PRICE_MIN_SIZE,
    }),
  );

  if (input.wasTotalText) {
    elements.push(...wasBlock(TOTAL_X, WAS_Y, `was ${input.wasTotalText}`, totalWidth));
  }

  elements.push(
    textEl(TOTAL_X, TOTAL_Y, input.totalText, TOTAL_SIZE, "BK", {
      width: totalWidth,
      lines: 1,
      align: "L",
      shrink: true,
      minSize: TOTAL_MIN_SIZE,
    }),
    ...unitOverrides(input.unit),
  );

  // ── dates ───────────────────────────────────────────────────────────────
  // Always `DD/MM/YY` here. The 60 × 40 label drops the year to fit a 90-dot
  // pre-printed cell; this one has 115 dots and no grid to obey, so it keeps
  // the year the legacy scale terminal always printed.
  elements.push(
    textEl(15, DATE_Y, formatDmy(input.packedOnIso, true), DATE_SIZE, "M", {
      width: 115,
      lines: 1,
      align: "L",
      shrink: true,
      minSize: DATE_MIN_SIZE,
    }),
    textEl(135, DATE_Y, formatDmy(input.usedByIso, true), DATE_SIZE, "M", {
      width: 105,
      lines: 1,
      align: "L",
      shrink: true,
      minSize: DATE_MIN_SIZE,
    }),
  );

  // ── symbol ──────────────────────────────────────────────────────────────
  if (input.barcode.kind === "ean13") {
    elements.push({
      kind: "barcode",
      sym: "ean13",
      x: BARCODE_X,
      y: BARCODE_Y,
      h: 70,
      module: 2,
      hri: true,
      data: input.barcode.data12,
    });
  } else {
    elements.push({
      kind: "qr",
      x: QR_X,
      y: QR_Y,
      mag: QR_MAG,
      ec: "M",
      data: input.barcode.qrData,
    });
  }

  return {
    media: "58100",
    elements,
    dbg: opts.dbg ?? false,
    ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
  };
}

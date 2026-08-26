/**
 * 58 × 100 ingredient label — the tall scale label, on **pre-printed stock**.
 *
 * Like the 60 × 40, this web is bought with the artwork already on it, so this
 * template prints *values only* into somebody else's cells. Nothing here draws a
 * caption, a box or a rule that the stock already carries — printing one would
 * double it. That is the whole difference from the version this replaced, which
 * was a straight port of the legacy scale terminal's full-bleed layout.
 *
 * The pre-printed furniture, in dots at 203 dpi:
 *
 *   yellow header ........ y 0–≈115    (store name)
 *   `$/KG` caption row ... y ≈ 480     (small captions over the three boxes)
 *   caption boxes ........ NET WEIGHT  x  37–131 ┐
 *                          UNIT PRICE  x 150–253 ├ black, y ≈ 517–540
 *                          TOTAL PRICE x 272–404 ┘
 *   rule ................. y ≈ 606
 *   PACKED ON ............ x  33–108 ┐ y ≈ 611–639
 *   USE BY ............... x 155–202 ┘
 *   yellow footer ........ y ≈ 735–800 (store address)
 *
 * So: **no store footer, no Korean, no unit suffix, and no `$`** — the header
 * carries the store, the customer this label is for reads the English, the
 * boxes say `KG` and `$/KG`, and a `$` is pre-printed over both money columns.
 * A leading `$` on any money input is stripped rather than demanded of the
 * caller, because the screens hold display strings.
 *
 * The coordinates are the hand-written ZPL the owner put on real stock and
 * confirmed against the artwork:
 *
 *   docs/label-mockups/58100-pre-2d.zpl   (PP QR)
 *
 * Read it before changing a number here, and print the change.
 *
 * Two known divergences from that file, both deliberate:
 *
 *   - the name is sized by measurement (`layoutNameBand`), so the mockup's
 *     hand-picked 34 becomes 26 for a name that needs two lines;
 *   - the `was` rules are as wide as the text actually measures, where the
 *     mockup's are hand-drawn. Same call the 60 × 40 template already makes.
 *
 * **Watch on the 1D variant:** the EAN sits at x 24 and is 190 dots wide, so it
 * runs to x 214 — under the `was` unit-price line, which starts at x 150. A
 * marked-down item printed on the 1D lane can therefore collide. The 2D lane
 * has no such problem (the QR is at x 310). Confirm on stock before the 1D
 * variant is used for markdowns.
 *
 * Input is mostly formatted strings — this library knows nothing about cents or
 * `momentAU`. Dates are the exception: they arrive as ISO (`YYYY-MM-DD`)
 * because *how* they are rendered is a layout decision (`formatScaleDates`,
 * shared with the 60 × 40 label), not a caller decision.
 */

import { textWidth } from "../measure";
import { layoutNameBand } from "../name-band";
import { strike, type Element, type Label } from "../model";
import { uomOverride } from "../uom-override";
import {
  amountOnly,
  formatScaleDates,
  textEl,
  type ScaleBarcode,
  type ScaleLabelInput,
  type TemplateOptions,
} from "./scale-6040";

export interface IngredientLabelInput extends ScaleLabelInput {
  /**
   * The statement panel. Free text, wrapped by the printer.
   *
   * Capped at five lines by `^FB` and **not shrunk**: a longer statement is
   * truncated at the fifth line rather than set in type nobody can read. If
   * that starts happening the statement is too long for this label, which is a
   * catalogue problem, not a layout one.
   */
  ingredients?: string | null;
}

// ── name band, under the pre-printed yellow header (y 0–115) ────────────────
// English only, **left** aligned — the 60 × 40 band is centred, this one is
// not, because the ingredient paragraph beneath it is a left-aligned block and
// a centred name over it reads as a mistake. `nameKo` is carried on the shared
// input and deliberately ignored here, the same as on the 60 × 40.
//
// `^FB` always allows two lines even in the one-line case: `measure.ts` is an
// approximation, so a name that measures just inside the budget and wraps on
// the printer anyway prints in full instead of losing its tail.
const NAME_X = 20;
const NAME_Y = 128;
const NAME_W = 424;
const NAME_LINES = 2;
const NAME_ONE_LINE_SIZE = 34;
const NAME_TWO_LINE_SIZE = 26;
/** Below this a name is unreadable at arm's length. */
const NAME_MIN_SIZE = 20;

// ── ingredient statement ────────────────────────────────────────────────────
// Fixed block: the name band above it is fixed at two lines' worth of room, so
// the paragraph does not move with the name the way the legacy layout's did.
const INGREDIENT_X = 20;
const INGREDIENT_Y = 212;
const INGREDIENT_W = 424;
const INGREDIENT_SIZE = 18;
const INGREDIENT_LINES = 5;

// ── `was` row, immediately above the pre-printed caption row (y ≈ 480) ──────
// The legacy label's rule, restored on owner instruction: no `$` (the stock
// prints one), **Black** 26, left-aligned at the column's box edge, and no
// block width — the line is as wide as it is, and its rule is measured to
// match. Black rather than Medium because a struck-through price set light
// disappears next to the Bold value under it; confirmed on stock.
const WAS_Y = 450;
const WAS_SIZE = 26;
const WAS_WEIGHT = "BK" as const;
const WAS_UNIT_PRICE_X = 150;
const WAS_TOTAL_X = 300;
/** The rule starts a shade left of the glyphs so it reads as a strike-through. */
const WAS_RULE_INSET = 2;

// ── value row, under the three black caption boxes (y ≈ 517–540) ────────────
// Centred in each box: suppliers reprint the web slightly out of registration,
// so values are centred with the mockup's margins rather than pushed against a
// box edge. Do not tighten them to "use the space".
const VALUE_Y = 562;
const VALUE_SIZE = 34;
const WEIGHT_X = 37;
const WEIGHT_W = 94;
const UNIT_PRICE_X = 150;
const UNIT_PRICE_W = 103;
/** The total is bigger, so it starts higher to stay optically on the row. */
const TOTAL_X = 272;
const TOTAL_Y = 556;
const TOTAL_W = 132;
const TOTAL_SIZE = 44;

// ── date row, under the rule at y ≈ 606 ─────────────────────────────────────
// Left-aligned under their captions, and sized by `formatScaleDates` — the same
// same-year-drops-the-year rule the 60 × 40 label uses, so a shelf of both
// labels reads consistently.
const DATE_Y = 660;
const DATE_W = 100;
const PACKED_X = 33;
const USED_BY_X = 155;

// ── symbol band, between the statement and the `was` row ────────────────────
// The QR is *bottom*-anchored: see `QrAnchor` in ../model — Zebra bottom-aligns
// ^BQ inside a box sized for the magnification's largest symbol, so a
// top-anchored symbol's real top edge moves with the payload length. Anchoring
// the bottom is what keeps a long PP payload off the `was` row below it.
//
// Magnification 2, not 3: a full PP payload is ~147 bytes — QR version 7 at
// level L, 90 dots square at mag 2 and 135 at mag 3.
// ── unit correction, over the pre-printed `$/KG` caption (x ≈ 150–178, y ≈ 507–517)
// The rule crosses the caption; the replacement goes to its right, where the
// artwork leaves room between the UNIT PRICE and TOTAL PRICE boxes.
// Grid-checked on stock — a first guess 19 dots higher missed the caption.
const UOM_RULE = { x: 146, y: 512, w: 38 };
const UOM_TEXT = { x: 190, y: 500 };
const UOM_SIZE = 20;

const QR_X = 310;
const QR_BOTTOM_Y = 440;
const QR_MAG = 2;
const EAN_X = 24;
const EAN_Y = 380;
const EAN_H = 80;
const EAN_MODULE = 2;

/**
 * A `was` price and the rule through it.
 *
 * The rule is measured from the text rather than fixed, because the was-price
 * is a caller string that can be four characters or eight and a hand-drawn
 * width would fall short of a longer one. There is no cell to clamp it to —
 * the line is set without a block width, so it is exactly as wide as it prints.
 */
function wasBlock(x: number, text: string): Element[] {
  return [
    textEl(x, WAS_Y, text, WAS_SIZE, WAS_WEIGHT),
    strike(
      x - WAS_RULE_INSET,
      WAS_Y + Math.round(WAS_SIZE / 2),
      textWidth(text, WAS_SIZE),
    ),
  ];
}

/** The one symbol that fills the band the pre-printed artwork leaves empty. */
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

export function buildIngredientLabel58100(
  input: IngredientLabelInput,
  opts: TemplateOptions = {},
): Label {
  const dates = formatScaleDates(input.packedOnIso, input.usedByIso);
  const name = layoutNameBand(input.nameEn, {
    width: NAME_W,
    oneLineSize: NAME_ONE_LINE_SIZE,
    twoLineSize: NAME_TWO_LINE_SIZE,
    minSize: NAME_MIN_SIZE,
    yOne: NAME_Y,
    yTwo: NAME_Y,
  });

  const elements: Element[] = [
    textEl(NAME_X, name.y, input.nameEn.trim(), name.size, "B", {
      width: NAME_W,
      lines: NAME_LINES,
      align: "L",
    }),
  ];

  const ingredients = input.ingredients?.trim();
  if (ingredients) {
    elements.push(
      textEl(INGREDIENT_X, INGREDIENT_Y, ingredients, INGREDIENT_SIZE, "M", {
        width: INGREDIENT_W,
        lines: INGREDIENT_LINES,
        align: "L",
      }),
    );
  }

  elements.push(symbol(input.barcode));

  if (input.wasUnitPriceText) {
    elements.push(...wasBlock(WAS_UNIT_PRICE_X, `was ${amountOnly(input.wasUnitPriceText)}`));
  }
  if (input.wasTotalText) {
    elements.push(...wasBlock(WAS_TOTAL_X, `was ${amountOnly(input.wasTotalText)}`));
  }

  elements.push(
    textEl(WEIGHT_X, VALUE_Y, input.weightText.trim(), VALUE_SIZE, "B", {
      width: WEIGHT_W,
      lines: 1,
      align: "C",
    }),
    textEl(UNIT_PRICE_X, VALUE_Y, amountOnly(input.unitPriceText), VALUE_SIZE, "B", {
      width: UNIT_PRICE_W,
      lines: 1,
      align: "C",
    }),
    textEl(TOTAL_X, TOTAL_Y, amountOnly(input.totalText), TOTAL_SIZE, "BK", {
      width: TOTAL_W,
      lines: 1,
      align: "C",
    }),
    ...uomOverride(input.unit, {
      captionRect: UOM_RULE,
      textPos: UOM_TEXT,
      size: UOM_SIZE,
    }),
    textEl(PACKED_X, DATE_Y, dates.packed, dates.size, "B", {
      width: DATE_W,
      lines: 1,
      align: "L",
    }),
    textEl(USED_BY_X, DATE_Y, dates.usedBy, dates.size, "B", {
      width: DATE_W,
      lines: 1,
      align: "L",
    }),
  );

  return {
    media: "58100",
    elements,
    dbg: opts.dbg ?? false,
    ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
  };
}

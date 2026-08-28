/**
 * scale-core — label data assembly.
 *
 * ## This file is the canon
 *
 * Ported from `ktpv5-retail-runner` `src/shared/scale-core/label-data.ts`,
 * which was itself a port of the retired `ktpv5-scale` app's
 * `libs/labelUtils.ts makeLabelData`. **This copy is now canonical and the
 * runner's is a sync target** — see `./weigh-pricing` for the directory's rules
 * (pure TypeScript, no import that leaves this directory).
 *
 * ## What survived the port from the legacy scale app
 *
 *   - The decision order and the exact failure strings (no unit price → no
 *     weight → 7-digit barcode → 12-digit embedded), because the screens branch
 *     on them.
 *   - The rounding order: dollars × kg, rounded once (owned by `weigh-pricing`).
 *   - The embedded price: strip the decimal point out of the printed total,
 *     zero-pad to five, append to the 7-digit item barcode for twelve.
 *
 * ## What was deliberately changed
 *
 *   - **Dates come in as display strings.** The original took a Moment and
 *     formatted `Do MMM YY` inside, which is how a display format ended up
 *     baked into the data layer and how the `07` field date bug happened. This
 *     module treats the display date as opaque text and carries the data-spec
 *     date separately, as ISO.
 *   - **The EAN-13 check digit is computed here** and exposed for preview. The
 *     original left it to printer firmware. The printer input stays 12 digits in
 *     `barcode`; the 13-digit form is `barcodeWithCheckDigit`.
 *   - **Markdown folds into the printed total *and* the embedded price.** The
 *     legacy 1D path did not know about markdown at all — it was a 2D-QR-only
 *     concept — so printing a marked-down 1D label produced a barcode that rang
 *     up the pre-markdown amount. On an embedded-price barcode **the scanned
 *     value is the amount charged**, so the markdown has to be inside it (the
 *     till receives `unit_price_adjusted` with qty 1.000 and re-applies
 *     nothing). Clamping lives in `weigh-pricing`. When a markdown applies, the
 *     pre-markdown total is exposed as `wasTotalPrice`.
 *   - **Input is level arrays**, and the face price is the canonical lowest-of
 *     (`resolveFacePrice`, level 0) rather than "promo always wins".
 *
 * ## 2D PP invariant — the anti-double-discount contract
 *
 * The PP payload's `02` (prices) and `03` (promoPrices) fields carry the
 * **original level arrays, before any markdown is folded in** (after manual
 * overrides, at the length they arrived with). Markdown rides **only** in
 * `05` (1 = pct, 2 = amt) and `06` (permill or cents).
 *
 * Folding markdown into `02`/`03` *and* emitting `05`/`06` discounts the item
 * twice at the till. So this module ships `pricesRaw` / `promoPricesRaw` /
 * `markdown` untouched, and the only thing it folds is the 1D embedded price.
 * There is a test pinning exactly that.
 */

import {
  applyMarkdown,
  computeTotalCents,
  formatCentsToDollars,
  parseWeightGrams,
  QTY_SCALE,
  resolveFacePrice,
} from "./weigh-pricing";
import type { MarkdownKind } from "./weigh-pricing";

export type ScaleLabelBarcodeMode = "embeddedPrice" | "pluOnly";
export type ScaleLabelBarcodeFormat = "ean13" | "code128";

/** Markdown — the PP `05`/`06` model: pct is permill (10% = 100), amt is cents. */
export type ScaleLabelMarkdown = { type: MarkdownKind; value: number };

export type ScaleLabelData = {
  name: string;
  /** Applied unit price, as dollars (`"12.34"`). */
  unitPrice: string;
  /** The pre-discount unit price when a promo applied, else null. */
  wasPrice: string | null;
  /** Final amount charged, markdown included. */
  totalPrice: string;
  /** The pre-markdown amount when a markdown applied, else null. */
  wasTotalPrice: string | null;
  /** Weighed item: kg to 3 places (`"1.036"`). Fixed: `fixed_net_weight` or `"N/A"`. */
  weight: string;
  /** Display only — the caller formats it. The data-spec date is `packedOnIso`. */
  packedOn: string;
  usedBy: string;
  /** Printer input: 12 digits in `embeddedPrice` mode, the item barcode in `pluOnly`. */
  barcode: string;
  /** 13 digits including the check digit — `embeddedPrice` mode only, for preview. */
  barcodeWithCheckDigit: string | null;
  barcodeFormat: ScaleLabelBarcodeFormat;
  unit: string;
  ingredients: string;

  // ── data-spec fields (2D PP builder input — see the header's invariant) ────
  /** packed-on, ISO `YYYY-MM-DD` (`07`). Null when not supplied. */
  packedOnIso: string | null;
  /** used-by, whole days after packed-on (`08`). Null when not supplied. */
  usedByOffsetDays: number | null;
  /**
   * The original level array (after manual overrides, **before** markdown) — PP
   * `02`. If a markdown ever changes this, that is the double-discount bug.
   */
  pricesRaw: number[] | null;
  /** The promo level array, same invariant — PP `03`. */
  promoPricesRaw: number[] | null;
  /** The applied markdown — PP `05`/`06`. Carried, never folded in here. */
  markdown: ScaleLabelMarkdown | null;
};

export type MakeLabelDataInput = {
  name_en: string;
  /** Level array (cents) — `item.price?.prices`, after manual overrides. */
  prices: number[] | null | undefined;
  /** Promo level array (cents). The server has already applied the validity window. */
  promoPrices: number[] | null | undefined;
  /** The scale reader's weight string (`"01036"`, grams). */
  weight: string;
  is_weight: boolean;
  /** Fixed-weight display text — ignored for a weighed item. */
  fixed_net_weight: string;
  /** Display-only formatted dates. */
  packedOnDisplay: string;
  usedByDisplay: string;
  /** Data-spec date — ISO `YYYY-MM-DD`, carried through independently. */
  packedOnIso?: string | null;
  usedByOffsetDays?: number | null;
  /** Item barcode — embedded-price mode requires exactly 7 digits (legacy check). */
  barcode: string;
  unit: string;
  ingredients: string;
  barcodeMode?: ScaleLabelBarcodeMode;
  /** Markdown — pct is permill, amt is cents. A value of 0 or less means none. */
  markdown?: ScaleLabelMarkdown | null;
};

/**
 * EAN-13 check digit for a 12-digit string — the GS1 rule (odd positions ×1,
 * even ×3, complement to 10). Null for anything that is not 12 digits.
 */
export function ean13CheckDigit(digits12: string): string | null {
  if (!/^\d{12}$/.test(digits12)) return null;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const d = digits12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * Assemble the label data.
 *
 * Failure returns a **reason string**, as the legacy implementation did, so the
 * caller branches on `typeof === "string"`. That convention is kept because the
 * weighing screen shows the reason where the barcode would be.
 */
export function makeLabelData(input: MakeLabelDataInput): ScaleLabelData | string {
  const {
    name_en,
    prices,
    promoPrices,
    weight,
    is_weight,
    fixed_net_weight,
    packedOnDisplay,
    usedByDisplay,
    packedOnIso = null,
    usedByOffsetDays = null,
    barcode,
    unit,
    ingredients,
    barcodeMode = "embeddedPrice",
    markdown = null,
  } = input;

  // Face price — canonical lowest-of at level 0 (a scale label is anonymous).
  const face = resolveFacePrice(prices, promoPrices, 0);
  if (face.effectiveCents <= 0) return "Invalid unit price";
  const unitPriceCents = face.effectiveCents;
  const wasPriceCents = face.discountedCents != null ? face.originalCents : null;

  const weightGrams = parseWeightGrams(weight);
  const weightInKg = weightGrams ? weightGrams / QTY_SCALE : 0;
  if (is_weight && !weightInKg) return "Weight Item requires weight";

  const baseTotalCents = computeTotalCents(unitPriceCents, is_weight, weightGrams);
  if (baseTotalCents == null) return "Weight Item requires weight";

  // 1D-only fold — the 2D fields below are left exactly as they arrived.
  const appliedMarkdown = markdown != null && markdown.value > 0 ? markdown : null;
  const totalCents = appliedMarkdown
    ? applyMarkdown(baseTotalCents, appliedMarkdown.type, appliedMarkdown.value)
    : baseTotalCents;
  const totalPrice = formatCentsToDollars(totalCents);

  if (barcode.length !== 7) return "Weight Item requires 7 digits barcode";

  let rawBarcode = barcode;
  let barcodeFormat: ScaleLabelBarcodeFormat = "code128";
  let barcodeWithCheckDigit: string | null = null;

  if (barcodeMode === "embeddedPrice") {
    // As the original did: the printed total with its decimal point removed,
    // zero-padded to five. $1000 and up becomes six digits and falls out of the
    // 12-digit check below as "Invalid barcode" — the legacy cap, kept.
    const embeddedPrice = totalPrice.replace(".", "").padStart(5, "0");
    rawBarcode = `${barcode}${embeddedPrice}`;
    barcodeFormat = "ean13";

    if (rawBarcode.length !== 12) return "Invalid barcode";

    const check = ean13CheckDigit(rawBarcode);
    if (check == null) return "Invalid barcode";
    barcodeWithCheckDigit = `${rawBarcode}${check}`;
  }

  return {
    name: name_en,
    unitPrice: formatCentsToDollars(unitPriceCents),
    wasPrice: wasPriceCents != null ? formatCentsToDollars(wasPriceCents) : null,
    totalPrice,
    wasTotalPrice: appliedMarkdown ? formatCentsToDollars(baseTotalCents) : null,
    weight: is_weight ? weightInKg.toFixed(3) : fixed_net_weight || "N/A",
    packedOn: packedOnDisplay,
    usedBy: usedByDisplay,
    barcode: rawBarcode,
    barcodeWithCheckDigit,
    barcodeFormat,
    unit,
    ingredients,

    packedOnIso,
    usedByOffsetDays,
    // Verbatim — folding these is the double-discount bug (see the header).
    pricesRaw: prices ?? null,
    promoPricesRaw: promoPrices ?? null,
    markdown: appliedMarkdown,
  };
}

/**
 * The prepacked (PP) barcode payload — `00:{…}` JSON in a QR.
 *
 * Numeric string keys, not names: the payload is printed as a QR on a scale
 * label and every character costs modules, so the schema trades readability for
 * symbol size. This file is the canonical definition; the runner carries a copy
 * kept in step by `scripts/sync-sale-core.mjs`.
 *
 * Keys, in the order the builder writes them:
 *
 *   00  schema version (currently 2)
 *   01  item barcode
 *   02  prices, one per price level
 *   03  promotional prices, one per price level
 *   04  weight, ×1000
 *   05  markdown type — 1 = percent, 2 = amount
 *   06  markdown amount (percent ×1000, or cents)
 *   07  packed-on date, ISO `YYYY-MM-DD`
 *   08  use-by, in whole days after `07`
 *
 * Unknown keys are ignored by the parser and always have been, which is what
 * makes adding 00/07/08 safe: a till running last month's build reads a label
 * printed by this one and simply does not see the new fields.
 */

export interface PPBarcode {
  barcode: string;
  prices: number[];
  promoPrices: number[];
  weight: number | null;
  discountType: "pct" | "amt" | null;
  discountAmount: number;
  /** Schema version from `00`. Absent on labels printed before it was added. */
  version?: number;
  /** ISO `YYYY-MM-DD` from `07`. */
  packedOn?: string;
  /** Whole days after `packedOn`, from `08`. */
  usedBy?: number;
}

const PP_PREFIX = "00:";

/** The version this build writes. Bump only with a reader in the field first. */
export const PP_VERSION = 2;

export function isPPBarcode(raw: string): boolean {
  return raw.startsWith(PP_PREFIX);
}

export function parsePPBarcode(raw: string): PPBarcode | null {
  if (!raw.startsWith(PP_PREFIX)) return null;
  try {
    const json = JSON.parse(raw.slice(PP_PREFIX.length));
    const dt = json["05"];
    const version = json["00"];
    const packedOn = json["07"];
    const usedBy = json["08"];
    return {
      barcode: String(json["01"]),
      prices: json["02"] ?? [],
      promoPrices: json["03"] ?? [],
      weight: json["04"] ?? null,
      discountType: dt === 1 ? "pct" : dt === 2 ? "amt" : null,
      discountAmount: json["06"] ?? 0,
      ...(typeof version === "number" ? { version } : {}),
      ...(typeof packedOn === "string" && packedOn ? { packedOn } : {}),
      ...(typeof usedBy === "number" ? { usedBy } : {}),
    };
  } catch {
    return null;
  }
}

export function buildPPBarcodeString(pp: {
  barcode: string;
  prices: number[];
  promoPrices: number[];
  weight?: number | null;
  discountType?: "pct" | "amt" | null;
  discountAmount?: number;
  /** ISO `YYYY-MM-DD`; omitted from the payload when absent. */
  packedOn?: string | null;
  /** Whole days after `packedOn`. */
  usedBy?: number | null;
}): string {
  const obj: Record<string, unknown> = {
    "00": PP_VERSION,
    "01": pp.barcode,
    "02": pp.prices,
    "03": pp.promoPrices,
  };
  if (pp.weight != null) obj["04"] = pp.weight;
  if (pp.discountType && pp.discountAmount) {
    obj["05"] = pp.discountType === "pct" ? 1 : 2;
    obj["06"] = pp.discountAmount;
  }
  if (pp.packedOn) obj["07"] = pp.packedOn;
  if (pp.usedBy != null) obj["08"] = pp.usedBy;
  return `${PP_PREFIX}${JSON.stringify(obj)}`;
}

export function calcMarkdownPrice(
  effectivePrice: number,
  discountType: "pct" | "amt",
  discountAmount: number,
): number {
  if (discountType === "pct") {
    return Math.max(
      0,
      Math.round((effectivePrice * (1000 - discountAmount)) / 1000),
    );
  }
  return Math.max(0, effectivePrice - discountAmount);
}

/**
 * Price-embedded EAN-13 — the scale's printed linear barcode, distinct from the
 * `00:` QR payload above: 12–13 digits with a "2"/"02" prefix (the same
 * candidacy test `generateSaleLineItem` uses to promote weight →
 * weight-prepacked), price in cents at digits 8–12 of the 13-digit form.
 *
 * F-2 (retail-runner, 2026-10-16): a fixed-weight ("prepacked") item reaches
 * the embedded-price branch on ANY of its barcodes, so the till must check
 * the shape first — a plain GTIN (e.g. `9300…`) is not a price carrier and
 * the line keeps its catalog price.
 */
export function isEmbeddedPriceBarcode(raw: string): boolean {
  if (!/^\d{12,13}$/.test(raw)) return false;
  return raw.startsWith("2") || raw.startsWith("02");
}

/**
 * Integer cents embedded in `raw`, or `null` when `raw` is not a
 * price-embedded EAN-13. A 12-digit UPC-A gains a leading 0 first so the
 * price digits sit at the EAN-13 offsets (same window as
 * `libs/scan-utils.ts embededPriceParser`, which returns dollars).
 */
export function parseEmbeddedPriceCents(raw: string): number | null {
  if (!isEmbeddedPriceBarcode(raw)) return null;
  const raw13 = raw.length === 12 ? "0" + raw : raw;
  return parseInt(raw13.slice(7, 12), 10);
}

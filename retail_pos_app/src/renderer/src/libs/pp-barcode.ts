export interface PPBarcode {
  barcode: string;
  prices: number[];
  promoPrices: number[];
  weight: number | null;
  discountType: "pct" | "amt" | null;
  discountAmount: number;
}

const PP_PREFIX = "00:";

export function isPPBarcode(raw: string): boolean {
  return raw.startsWith(PP_PREFIX);
}

export function parsePPBarcode(raw: string): PPBarcode | null {
  if (!raw.startsWith(PP_PREFIX)) return null;
  try {
    const json = JSON.parse(raw.slice(PP_PREFIX.length));
    const dt = json["05"];
    return {
      barcode: String(json["01"]),
      prices: json["02"] ?? [],
      promoPrices: json["03"] ?? [],
      weight: json["04"] ?? null,
      discountType: dt === 1 ? "pct" : dt === 2 ? "amt" : null,
      discountAmount: json["06"] ?? 0,
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
}): string {
  const obj: Record<string, unknown> = {
    "01": pp.barcode,
    "02": pp.prices,
    "03": pp.promoPrices,
  };
  if (pp.weight != null) obj["04"] = pp.weight;
  if (pp.discountType && pp.discountAmount) {
    obj["05"] = pp.discountType === "pct" ? 1 : 2;
    obj["06"] = pp.discountAmount;
  }
  return `${PP_PREFIX}${JSON.stringify(obj)}`;
}

export function calcMarkdownPrice(
  effectivePrice: number,
  discountType: "pct" | "amt",
  discountAmount: number,
): number {
  if (discountType === "pct") {
    return Math.round((effectivePrice * (1000 - discountAmount)) / 1000);
  }
  return effectivePrice - discountAmount;
}

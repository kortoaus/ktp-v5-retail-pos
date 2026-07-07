export const PP_PREFIX = "00:";
const PP_PAYLOAD_VERSION = 2;

export type PickupWorkLabelQrPayloadInput = {
  barcode: string;
  prices: number[];
  promoPrices: unknown;
  optionTotal: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function keepFiniteNumbers(values: unknown[]): number[] {
  return values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
}

export function normalizePromoPrices(value: unknown): number[] {
  if (Array.isArray(value)) return keepFiniteNumbers(value);
  if (isRecord(value) && Array.isArray(value.prices)) {
    return keepFiniteNumbers(value.prices);
  }
  return [];
}

function addOptionTotal(prices: number[], optionTotal: number): number[] {
  return prices.map((price) => Math.max(0, Math.round(price + optionTotal)));
}

export function buildPickupWorkLabelQrPayload({
  barcode,
  prices,
  promoPrices,
  optionTotal,
}: PickupWorkLabelQrPayloadInput): string {
  const payload: Record<string, unknown> = {
    "00": PP_PAYLOAD_VERSION,
    "01": barcode,
    "02": addOptionTotal(prices, optionTotal),
    "03": addOptionTotal(normalizePromoPrices(promoPrices), optionTotal),
  };

  return `${PP_PREFIX}${JSON.stringify(payload)}`;
}

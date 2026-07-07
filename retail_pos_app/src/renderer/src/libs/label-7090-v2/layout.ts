export type PriceTag7090CornerTextSource = {
  barcodeText: string;
  code?: string | null;
};

export function getPriceTag7090CornerText(
  source: PriceTag7090CornerTextSource,
): string {
  return source.barcodeText.trim() || "-";
}

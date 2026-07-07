export const PRICE_TAG_7030_TEXT = {
  nameKoMaxChars: 18,
  nameEnMaxChars: 30,
  nameKoMaxLines: 1,
  nameEnMaxLines: 2,
} as const;

export type PriceTag7030ProductRowKind = "ko" | "en" | "barcode";

export type PriceTag7030ProductRow = {
  kind: PriceTag7030ProductRowKind;
  text: string;
};

export type PriceTag7030SplitText = (
  text: string,
  maxChars: number,
) => string[];

export type BuildPriceTag7030ProductRowsInput = {
  nameKo: string;
  nameEn: string;
  barcodeText: string;
  splitText: PriceTag7030SplitText;
};

export function buildPriceTag7030ProductRows({
  nameKo,
  nameEn,
  barcodeText,
  splitText,
}: BuildPriceTag7030ProductRowsInput): PriceTag7030ProductRow[] {
  const koLines = splitText(
    nameKo,
    PRICE_TAG_7030_TEXT.nameKoMaxChars,
  ).slice(0, PRICE_TAG_7030_TEXT.nameKoMaxLines);
  const enLines = splitText(
    nameEn,
    PRICE_TAG_7030_TEXT.nameEnMaxChars,
  ).slice(0, PRICE_TAG_7030_TEXT.nameEnMaxLines);

  return [
    ...koLines.map((text) => ({ kind: "ko" as const, text })),
    ...enLines.map((text) => ({ kind: "en" as const, text })),
    { kind: "barcode", text: barcodeText.trim() || "-" },
  ];
}

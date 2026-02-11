import {
  LabelBuilder,
  type LabelLanguage,
  type LabelOutput,
} from "./label-builder";

interface PriceTagData {
  name_ko: string;
  name_en: string;
  price: string;
  barcode: string;
  barcodeFormat: "GTIN" | "RAW";
}

function splitLines(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    lines.push(text.substring(i, i + maxChars));
  }
  return lines;
}

// 60mm x 30mm @ 203dpi = 480 x 240 dots
export function buildPriceTag60x30(
  language: LabelLanguage,
  data: PriceTagData,
): LabelOutput {
  const { name_en, name_ko, price, barcode, barcodeFormat } = data;
  const [dollar, cent] = price.split(".");
  const dollarWidth = 35;
  const dollarOffset = 40 * dollar.length;
  const charLengthKo = 18;
  const charLengthEn = 30;
  const lineHeight = 30;

  const builder = new LabelBuilder().setSize(550, 240);

  builder.text(5, 20, "$", 41, true);
  builder.text(dollarWidth, 10, dollar, 61, true);
  builder.text(dollarWidth + dollarOffset, 15, ".", 41, true);
  builder.text(dollarWidth + 15 + dollarOffset, 15, cent, 41, true);

  let y = 100;

  for (const line of splitLines(name_ko, charLengthKo)) {
    builder.text(10, y, line, 21, true);
    y += lineHeight;
  }

  for (const line of splitLines(name_en, charLengthEn)) {
    builder.text(10, y, line, 21, false);
    y += lineHeight;
  }

  builder.barcode(190, 20, barcode, 30, true, barcodeFormat);

  return builder.build(language);
}

import { Item } from "../types/models";
import { MONEY_DP, MONEY_SCALE } from "./constants";
import { fmtDateRangeStr } from "./dayjsAU";
import { itemNameParser } from "./item-utils";
import {
  BarcodeFormat,
  LabelBuilder,
  type LabelLanguage,
  type LabelOutput,
} from "./label-builder";

function fmtMoney(cents: number): string {
  return `$${(cents / MONEY_SCALE).toFixed(MONEY_DP)}`;
}
interface PriceTagData {
  name_ko: string;
  name_en: string;
  price: string;
  barcode: string;
  barcodeFormat: BarcodeFormat;
}

interface PPLabelData {
  name_ko: string;
  name_en: string;
  unitPrice: string;
  totalPrice: string;
  weight: string | null;
  ppBarcode: string;
}

function splitLines(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    lines.push(text.substring(i, i + maxChars));
  }
  return lines;
}

// @deprecated Use buildPriceTag7030 instead
// 70mm x 30mm @ 203dpi = 560 x 240 dots
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

  const barcodeOffset = barcodeFormat === "EAN13" ? 230 : 190;

  builder.barcode(barcodeOffset, 20, barcode, 30, true, barcodeFormat);

  return builder.build(language);
}

// @deprecated Use buildPPLabel60x30 instead
// 60mm x 30mm @ 203dpi = 480 x 240 dots — PP: DataMatrix label
export function buildPPLabel60x30(
  language: LabelLanguage,
  data: PPLabelData,
): LabelOutput {
  const { name_en, name_ko, unitPrice, totalPrice, weight, ppBarcode } = data;
  const [dollar, cent] = totalPrice.split(".");
  const dollarWidth = 35;
  const dollarOffset = 40 * dollar.length;

  const builder = new LabelBuilder().setSize(550, 240);

  builder.text(5, 20, "$", 41, true);
  builder.text(dollarWidth, 10, dollar, 61, true);
  builder.text(dollarWidth + dollarOffset, 15, ".", 41, true);
  builder.text(dollarWidth + 15 + dollarOffset, 15, cent, 41, true);

  if (weight) {
    builder.text(10, 80, `${weight}kg x $${unitPrice}/kg`, 21, false);
  }

  let y = weight ? 110 : 80;
  for (const line of splitLines(name_ko, 18)) {
    builder.text(10, y, line, 21, true);
    y += 30;
  }
  for (const line of splitLines(name_en, 30)) {
    builder.text(10, y, line, 21, false);
    y += 30;
  }

  builder.qrcode(330, 10, ppBarcode, 2);

  return builder.build(language);
}

export function buildPriceTag7030(
  labelLanguage: LabelLanguage,
  item: Item,
): LabelOutput {
  const { name_en, name_ko } = itemNameParser(item);
  const { promoPrice } = item;
  const hasPromo = promoPrice != null;
  const dateRange = hasPromo
    ? fmtDateRangeStr(promoPrice.validFrom, promoPrice.validTo)
    : null;
  const priceStr = fmtMoney(item.price?.prices[0] ?? 0);
  const currentPriceStr = hasPromo
    ? fmtMoney(promoPrice.prices[0] ?? 0)
    : priceStr;
  const wasPrice = hasPromo ? priceStr : null;
  const [dollar, cent] = currentPriceStr.replace("$", "").split(".");
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

  const uomX = dollarWidth + 15 + dollarOffset + 25 * cent.length + 5;
  builder.text(uomX, 40, `/${item.uom}`, 21, false);

  let y = 90;

  if (hasPromo && wasPrice && dateRange) {
    builder.text(10, y, `was ${wasPrice}  ${dateRange}`, 21, false);
    y += lineHeight;
  } else if (hasPromo && wasPrice) {
    builder.text(10, y, `was ${wasPrice}`, 21, false);
    y += lineHeight;
  }

  for (const line of splitLines(name_ko, charLengthKo)) {
    builder.text(10, y, line, 21, true);
    y += lineHeight;
  }

  for (const line of splitLines(name_en, charLengthEn)) {
    builder.text(10, y, line, 21, false);
    y += lineHeight;
  }

  builder.datamatrix(350, 10, item.barcode, 4);

  return builder.build(labelLanguage);
}

export function buildPriceTag7090(
  labelLanguage: LabelLanguage,
  item: Item,
): LabelOutput {
  const { name_en, name_ko } = itemNameParser(item);
  const { promoPrice } = item;
  const hasPromo = promoPrice != null;

  const priceStr = fmtMoney(item.price?.prices[0] ?? 0);
  const memberPriceStr = fmtMoney(item.price?.prices[1] ?? 0);

  const promoPriceStr = hasPromo ? fmtMoney(promoPrice?.prices[0] ?? 0) : null;
  const memberPromoPriceStr = hasPromo
    ? fmtMoney(promoPrice?.prices[1] ?? 0)
    : null;

  const currentPriceStr = promoPriceStr ?? priceStr;
  const wasPrice = hasPromo ? priceStr : null;

  const promoNameEn = hasPromo ? promoPrice.name_en : null;
  const promoNameKo = hasPromo ? promoPrice.name_ko : null;
  const dateRange = hasPromo
    ? fmtDateRangeStr(promoPrice.validFrom, promoPrice.validTo)
    : null;

  const memberCurrentStr = memberPromoPriceStr ?? memberPriceStr;
  const wasMemberPrice = hasPromo ? memberPriceStr : null;

  const charLengthKo = 25;
  const charLengthEn = 40;
  const lineHeight = 40;

  const builder = new LabelBuilder().setSize(560, 720);

  let y = 10;

  if (hasPromo) {
    builder.text(10, y, "[PROMO]", 41, true);
    y += 70;

    if (promoNameKo) {
      for (const line of splitLines(promoNameKo, charLengthKo)) {
        builder.text(10, y, line, 21, true);
        y += lineHeight;
      }
    }

    if (promoNameEn) {
      for (const line of splitLines(promoNameEn, charLengthEn)) {
        builder.text(10, y, line, 21, false);
        y += lineHeight;
      }
    }

    y += 10;
  }

  const col2 = 280;
  const [gDollar, gCent] = currentPriceStr.replace("$", "").split(".");
  const [mDollar, mCent] = memberCurrentStr.replace("$", "").split(".");
  const dw = 35;
  const dOff = 40;

  function renderPrice(
    x: number,
    py: number,
    prefix: string,
    dollar: string,
    cent: string,
  ) {
    let px = x;
    builder.text(px, py + 15, prefix, 21, true);
    px += 15;
    builder.text(px, py + 10, "$", 41, true);
    px += dw;
    builder.text(px, py, dollar, 61, true);
    px += dOff * dollar.length;
    builder.text(px, py + 5, ".", 41, true);
    builder.text(px + 15, py + 5, cent, 41, true);
    px += 15 + 25 * cent.length + 5;
    builder.text(px, py + 30, `/${item.uom}`, 21, false);
  }

  const showMember = currentPriceStr !== memberCurrentStr;

  if (showMember) {
    renderPrice(10, y, "G", gDollar, gCent);
    renderPrice(col2, y, "M", mDollar, mCent);
  } else {
    renderPrice(10, y, "", gDollar, gCent);
  }

  y += 70;

  if (hasPromo && wasPrice) {
    builder.text(10, y, `was ${wasPrice}`, 21, false);
    if (showMember) {
      builder.text(col2, y, `was ${wasMemberPrice}`, 21, false);
    }
    y += lineHeight;
  }

  y += 15;

  for (const line of splitLines(name_ko, charLengthKo)) {
    builder.text(10, y, line, 21, true);
    y += lineHeight;
  }

  for (const line of splitLines(name_en, charLengthEn)) {
    builder.text(10, y, line, 21, false);
    y += lineHeight;
  }

  if (hasPromo && dateRange) {
    builder.text(10, 590, dateRange, 21, false);
  }

  builder.datamatrix(430, 590, item.barcode, 6);

  return builder.build(labelLanguage);
}

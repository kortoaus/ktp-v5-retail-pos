import { Item } from "../types/models";
import { SaleLineItem } from "../types/sales";
import { embededPriceParser } from "./scan-utils";

export type ItemTypes =
  | "invalid"
  | "prepacked"
  | "weight"
  | "weight-prepacked"
  | "normal";

export const itemNameParser = (item: Item) => {
  const { brand } = item;
  const brandNameEn = brand ? `[${brand.name_en}] ` : "";
  const brandNameKo = brand ? `[${brand.name_ko}] ` : "";

  const name_en = `${brandNameEn}${item.name_en}`;
  const name_ko = `${brandNameKo}${item.name_ko}`;

  const name_invoice = item.name_invoice || name_en || name_ko;

  return {
    name_en: name_en,
    name_ko: name_ko,
    name_invoice: name_invoice,
  };
};

export const getItemType = (item: Item): ItemTypes => {
  const { isScale, scaleData } = item;

  if (isScale) {
    if (!scaleData) return "invalid";
    const { isFixedWeight } = scaleData;
    return isFixedWeight ? "prepacked" : "weight";
  } else {
    return "normal";
  }
};

export const generateSaleLineItem = (
  item: Item,
  rawBarcode: string,
): SaleLineItem => {
  const { id, taxable, uom, barcode, barcodeGTIN } = item;
  const { name_en, name_ko } = itemNameParser(item);
  let type = getItemType(item);
  let price = item.price;
  let promoPrice = item.promoPrice;

  const isCandidateEAN13 = rawBarcode.length === 12 || rawBarcode.length === 13;
  const isCandidatePrepacked =
    rawBarcode.startsWith("2") || rawBarcode.startsWith("02");

  if (type === "weight" && isCandidateEAN13 && isCandidatePrepacked) {
    type = "weight-prepacked";
  }

  return {
    type: price === null ? "invalid" : type,
    itemId: id,
    name_en,
    name_ko,
    price,
    promoPrice,
    taxable,
    uom: type === "weight" ? "kg" : uom.toLowerCase(),
    barcode: barcodeGTIN || barcode,
  };
};

import { Item } from "../types/models";
import { ItemTypes, SaleLineItem } from "../types/sales";

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

export const generateSaleLineItem = (item: Item): SaleLineItem => {
  const { id, price, promoPrice, taxable, uom, barcode, barcodeGTIN } = item;
  const { name_en, name_ko } = itemNameParser(item);
  const type = getItemType(item);

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

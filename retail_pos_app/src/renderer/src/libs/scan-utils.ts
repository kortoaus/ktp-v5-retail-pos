import { searchItemByBarcode } from "../service/item.service";
import { Item } from "../types/models";

export const scanUtils = {};

export function embededPriceParser(rawBarcode: string) {
  // from 8th digit to 12th digit, 5 digits.
  const priceDigits = parseInt(rawBarcode.slice(7, 12));
  console.log(priceDigits);
  const price = priceDigits / 100;
  return price;
}

export async function cachedOrFetchItem(
  rawBarcode: string,
  cachedItems: Item[] = [],
) {
  const cachedFullBarcodeItem = cachedItems.find(
    (item) => item.barcode === rawBarcode,
  );
  if (cachedFullBarcodeItem) {
    return cachedFullBarcodeItem;
  }

  if (rawBarcode.length === 13) {
    const plu = rawBarcode.slice(0, 7);
    const cachedPluItem = cachedItems.find((item) => item.barcode === plu);
    if (cachedPluItem) {
      return cachedPluItem;
    }
  }

  const { ok, result } = await searchItemByBarcode(rawBarcode);
  if (!ok || !result) return null;
  return result;
}

import { Item } from "../../generated/prisma/browser";
import { BarcodeType } from "../../generated/prisma/enums";
import { getNormalizedBarcode } from "../../libs/barcode-utils";
import db from "../../libs/db";
import { ItemInclude } from "./item.query.option";
import { patchItemPriceService } from "./item.service";

function extractCandidatePLU(raw: string): string | null {
  // digits only 전제
  if (!/^\d+$/.test(raw)) return null;

  // 정상 케이스: 02 + IIIII
  if (raw.length >= 7 && raw.startsWith("02")) {
    return raw.slice(0, 7);
  }

  if (raw.length === 13 && raw.startsWith("02")) {
    return raw.slice(0, 7);
  }

  // 스캐너가 앞의 0을 날린 케이스: 2 + IIIII
  if (raw.length >= 6 && raw.startsWith("2")) {
    const candidate = "0" + raw.slice(0, 6); // 02 + IIIII
    if (candidate.length === 7) return candidate;
  }

  return null;
}

export async function getItemByRawBarcode(barcode: string) {
  const item = await db.item.findFirst({
    where: {
      barcodeType: BarcodeType.RAW,
      barcode: {
        contains: barcode,
        mode: "insensitive" as const,
      },
      archived: false,
    },
    include: ItemInclude,
  });
  if (item) {
    const result = await patchItemPriceService([item]).then(
      (items) => items[0],
    );
    return result;
  }
  return null;
}

export async function getItemByGTIN(gtin14: string) {
  const item = await db.item.findFirst({
    where: {
      barcodeGTIN: gtin14,
    },
    include: ItemInclude,
  });
  if (item) {
    const result = await patchItemPriceService([item]).then(
      (items) => items[0],
    );
    return result;
  }
  return null;
}

export async function getItemByPLU(plu: string) {
  const item = await db.item.findFirst({
    where: {
      barcodePLU: plu,
    },
    include: ItemInclude,
  });
  if (item) {
    const result = await patchItemPriceService([item]).then(
      (items) => items[0],
    );
    return result;
  }
  return null;
}

export async function getItemByBarcode(rawBarcode: string) {
  const { gtin14, type } = getNormalizedBarcode(rawBarcode);
  console.log(type, gtin14);

  // check by gtin14 first
  if (gtin14) {
    // check by gtin14
    const gtin14Item = await getItemByGTIN(gtin14);
    console.log(gtin14Item);
    if (gtin14Item) {
      return {
        ok: true,
        result: gtin14Item,
        msg: "Success",
      };
    }
  }

  // can be plu item?
  if (rawBarcode.length < 14) {
    if (rawBarcode.startsWith("02") || rawBarcode.startsWith("2")) {
      const cadidatePLU = extractCandidatePLU(rawBarcode);
      console.log(cadidatePLU);
      if (cadidatePLU) {
        const pluItem = await getItemByPLU(cadidatePLU);
        if (pluItem) {
          return {
            ok: true,
            result: pluItem,
            msg: "Success",
          };
        }
      }
    }
  }

  return {
    ok: false,
    result: null,
    msg: "No barcode matched item found",
  };
}

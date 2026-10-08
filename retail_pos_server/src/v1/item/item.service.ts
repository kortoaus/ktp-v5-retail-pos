import { PromoPrice } from "../../generated/prisma/browser";
import { Item, Price } from "../../generated/prisma/client";
import db from "../../libs/db";
import { enrichItemsWithPrices } from "./item.enrich";

type ItemWithPrice = Item & {
  price: Price | null;
  promoPrice: PromoPrice | null;
};

export async function patchItemPriceService(
  items: Item[],
): Promise<ItemWithPrice[]> {
  const itemIds = items.map((item) => item.id);
  const prices = await db.price.findMany({
    where: {
      itemId: {
        in: itemIds,
      },
      archived: false,
    },
  });

  const now = new Date();
  const promoPrices = await db.promoPrice.findMany({
    where: {
      itemId: {
        in: itemIds,
      },
      archived: false,
      validFrom: {
        lte: now,
      },
      validTo: {
        gte: now,
      },
    },
  });

  // T-24 (R-13) — Map join, first match per item (as Array.find did).
  const result = enrichItemsWithPrices(items, prices, promoPrices);

  return result;
}

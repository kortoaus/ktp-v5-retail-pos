import { PromoPrice } from "../../generated/prisma/browser";
import { Item, Price } from "../../generated/prisma/client";
import db from "../../libs/db";

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
        gte: now,
      },
      validTo: {
        lte: now,
      },
    },
  });

  const result = items.map((item) => {
    const price = prices.find((price) => price.itemId === item.id) || null;
    const promoPrice =
      promoPrices.find((promoPrice) => promoPrice.itemId === item.id) || null;
    return {
      ...item,
      price,
      promoPrice,
    };
  });

  return result;
}

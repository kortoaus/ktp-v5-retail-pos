import db from "../../libs/db";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { ItemInclude } from "../item/item.query.option";

type UpsertHotkeyDTO = {
  id?: number;
  name: string;
  sort: number;
  keys: UpsertHotkeyItemDTO[];
  color: string;
};

type UpsertHotkeyItemDTO = {
  x: number;
  y: number;
  itemId: number;
  name: string;
  color: string;
};

export async function upsertHotkeyService(data: UpsertHotkeyDTO) {
  const { id, keys, ...rest } = data;

  try {
    if (typeof id === "number") {
      // update
      const exist = await db.hotkey.findUnique({
        where: {
          id,
        },
      });

      if (!exist) {
        throw new NotFoundException("Hotkey not found");
      }

      const updatedHotkey = await db.hotkey.update({
        where: {
          id,
        },
        data: {
          ...rest,
        },
      });

      await db.hotkeyItem.deleteMany({
        where: {
          hotkeyId: id,
        },
      });

      const updatedKeys = await db.hotkeyItem.createManyAndReturn({
        data: keys.map((key) => ({
          ...key,
          hotkeyId: id,
        })),
      });

      return {
        ok: true,
        result: {
          ...updatedHotkey,
          keys: updatedKeys,
        },
      };
    } else {
      // create
      const newHotkey = await db.hotkey.create({
        data: {
          ...rest,
        },
      });

      const newKeys = await db.hotkeyItem.createManyAndReturn({
        data: keys.map((key) => ({
          ...key,
          hotkeyId: newHotkey.id,
        })),
      });

      return {
        ok: true,
        result: {
          ...newHotkey,
          keys: newKeys,
        },
      };
    }
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error upserting hotkey:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function deleteHotkeyService(id: number) {
  try {
    const exist = await db.hotkey.findUnique({ where: { id } });
    if (!exist) {
      throw new NotFoundException("Hotkey not found");
    }

    await db.hotkeyItem.deleteMany({ where: { hotkeyId: id } });
    await db.hotkey.delete({ where: { id } });

    return { ok: true };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error deleting hotkey:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function getHotkeysService() {
  try {
    const hotkeys = await db.hotkey.findMany({
      orderBy: {
        sort: "asc",
      },
      include: {
        keys: true,
      },
    });

    const allKeys = hotkeys.flatMap((hotkey) => hotkey.keys);
    const distinctItemIds = [...new Set(allKeys.map((key) => key.itemId))];
    const items = await db.item.findMany({
      where: {
        id: {
          in: distinctItemIds,
        },
      },
    });

    const result = hotkeys.map((hotkey) => ({
      ...hotkey,
      keys: hotkey.keys.map((key) => ({
        ...key,
        item: items.find((item) => item.id === key.itemId),
      })),
    }));

    return {
      ok: true,
      result,
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error getting hotkeys:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function getCloudHotkeysService() {
  try {
    const result = await db.cloudHotkey.findMany({
      orderBy: {
        sort: "asc",
      },
      include: {
        keys: true,
      },
    });

    const allKeys = result.flatMap((hotkey) => hotkey.keys);
    const distinctItemIds = [...new Set(allKeys.map((key) => key.itemId))];

    const [items, prices, promoPrices] = await Promise.all([
      db.item.findMany({
        where: {
          id: {
            in: distinctItemIds,
          },
        },
        include: ItemInclude,
      }),
      db.price.findMany({
        where: {
          itemId: {
            in: distinctItemIds,
          },
          archived: false,
        },
      }),
      db.promoPrice.findMany({
        where: {
          itemId: {
            in: distinctItemIds,
          },
          archived: false,
          validFrom: {
            lte: new Date(),
          },
          validTo: {
            gte: new Date(),
          },
        },
      }),
    ]);

    const itemsWithPrices = items.map((item) => {
      const price = prices.find((price) => price.itemId === item.id) || null;
      const promoPrice =
        promoPrices.find((promoPrice) => promoPrice.itemId === item.id) || null;

      return {
        ...item,
        price: price ? { ...price, prices: price.prices.slice(0, 1) } : null,
        promoPrice: promoPrice
          ? { ...promoPrice, prices: promoPrice.prices.slice(0, 1) }
          : null,
      };
    });

    const resultWithItems = result.map((hotkey) => ({
      ...hotkey,
      keys: hotkey.keys.map((key) => ({
        ...key,
        item: itemsWithPrices.find((item) => item.id === key.itemId),
      })),
    }));

    return { ok: true, result: resultWithItems };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error getting cloud hotkeys:", e);
    throw new InternalServerException("Internal server error");
  }
}

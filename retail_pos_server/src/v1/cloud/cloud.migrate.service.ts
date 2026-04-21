import { Brand, Category, Price } from "../../generated/prisma/browser";
import {
  CloudHotkey,
  CloudHotkeyItem,
  Company,
  Item,
  ItemCategory,
  ItemScaleData,
  PromoPrice,
} from "../../generated/prisma/client";
import { getNormalizedBarcode } from "../../libs/barcode-utils";
import apiService from "../../libs/cloud.api";
import db from "../../libs/db";
import { BadRequestException, HttpException } from "../../libs/exceptions";

const tag = "[cloud-migrate]";

type ItemWithRelations = Item & {
  scaleData: ItemScaleData | null;
  categories: ItemCategory[];
};

export async function cloudItemMigrateService() {
  try {
    const lastUpdatedAt = await db.item
      .findFirst({
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      })
      .then((r) => r?.updatedAt?.getTime() || 0);

    const { ok, msg, result } = await apiService.post<ItemWithRelations[]>(
      "/device/migrate/item",
      { lastUpdatedAt },
    );

    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate items from cloud",
      );
    }

    console.log(`${tag} items: ${result.length} received`);

    for (const item of result) {
      const { scaleData, categories, ...itemData } = item;
      const { type, gtin14, plu } = getNormalizedBarcode(item.barcode);

      await db.item.upsert({
        where: { id: item.id },
        update: {
          ...itemData,
          parentId: null,
          barcodeType: type,
          barcodeGTIN: gtin14,
          barcodePLU: plu,
        },
        create: {
          ...itemData,
          parentId: null,
          barcodeType: type,
          barcodeGTIN: gtin14,
          barcodePLU: plu,
        },
      });

      if (scaleData) {
        await db.itemScaleData.deleteMany({ where: { itemId: item.id } });
        await db.itemScaleData.create({
          data: { ...scaleData, itemId: item.id },
        });
      }

      if (categories && categories.length > 0) {
        await db.itemCategory.deleteMany({ where: { itemId: item.id } });
        await db.itemCategory.createMany({
          data: categories.map((c) => ({
            itemId: item.id,
            categoryId: c.categoryId,
          })),
        });
      }
    }

    for (const item of result) {
      await db.item.update({
        where: { id: item.id },
        data: { parentId: item.parentId },
      });
    }

    console.log(`${tag} items: ${result.length} synced`);
    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error(`${tag} items: error`, e);
    return false;
  }
}

export async function cloudCategoryMigrateService() {
  try {
    const lastUpdatedAt = await db.category
      .findFirst({
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      })
      .then((r) => r?.updatedAt?.getTime() || 0);

    const { ok, msg, result } = await apiService.post<Category[]>(
      "/device/migrate/category",
      { lastUpdatedAt },
    );

    console.log(result);

    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate categories from cloud",
      );
    }

    const parents = result.filter((c) => !c.parentId);
    const children = result.filter((c) => c.parentId);

    for (const category of parents) {
      await db.category.upsert({
        where: { id: category.id },
        update: { ...category, parentId: null },
        create: { ...category, parentId: null },
      });
    }

    for (const category of children) {
      await db.category.upsert({
        where: { id: category.id },
        update: { ...category },
        create: { ...category },
      });
    }

    console.log(`${tag} categories: ${result.length} synced`);
    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error(`${tag} categories: error`, e);
    return false;
  }
}

export async function cloudBrandMigrateService() {
  try {
    const lastUpdatedAt = await db.brand
      .findFirst({
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      })
      .then((r) => r?.updatedAt?.getTime() || 0);

    const { ok, msg, result } = await apiService.post<Brand[]>(
      "/device/migrate/brand",
      { lastUpdatedAt },
    );

    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate brands from cloud",
      );
    }

    for (const brand of result) {
      await db.brand.upsert({
        where: { id: brand.id },
        update: { ...brand },
        create: { ...brand },
      });
    }

    console.log(`${tag} brands: ${result.length} synced`);
    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error(`${tag} brands: error`, e);
    return false;
  }
}

export async function cloudPriceMigrateService() {
  try {
    const lastUpdatedAt = await db.price
      .findFirst({
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      })
      .then((r) => r?.updatedAt?.getTime() || 0);

    const { ok, msg, result } = await apiService.post<Price[]>(
      "/device/migrate/price/retail",
      { lastUpdatedAt },
    );

    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate prices from cloud",
      );
    }

    for (const { prices, ...rest } of result) {
      const data = { ...rest, prices };
      await db.price.upsert({
        where: { id: rest.id },
        update: data,
        create: data,
      });
    }

    console.log(`${tag} prices: ${result.length} synced`);
    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error(`${tag} prices: error`, e);
    return false;
  }
}

export async function cloudPromoPriceMigrateService() {
  try {
    const lastUpdatedAt = await db.promoPrice
      .findFirst({
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      })
      .then((r) => r?.updatedAt?.getTime() || 0);

    const { ok, msg, result } = await apiService.post<PromoPrice[]>(
      "/device/migrate/promo-price/retail",
      { lastUpdatedAt },
    );

    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate promo prices from cloud",
      );
    }

    for (const { prices, ...rest } of result) {
      const data = { ...rest, prices };
      await db.promoPrice.upsert({
        where: { id: rest.id },
        update: data,
        create: data,
      });
    }

    console.log(`${tag} promo-prices: ${result.length} synced`);
    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error(`${tag} promo-prices: error`, e);
    return false;
  }
}

export async function cloudCompanyMigrateService() {
  try {
    const { ok, msg, result } = await apiService.post<Company>(
      "/device/migrate/company",
    );
    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate company from cloud",
      );
    }

    await db.company.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        cloudId: result.cloudId,
        name: result.name,
        phone: result.phone,
        address1: result.address1,
        address2: result.address2,
        suburb: result.suburb,
        state: result.state,
        postcode: result.postcode,
        country: result.country,
        abn: result.abn,
        website: result.website,
        email: result.email,
      },
      update: {
        cloudId: result.cloudId,
        name: result.name,
        phone: result.phone,
        address1: result.address1,
        address2: result.address2,
        suburb: result.suburb,
        state: result.state,
        postcode: result.postcode,
        country: result.country,
        abn: result.abn,
        website: result.website,
        email: result.email,
      },
    });

    await db.storeSetting.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        companyId: result.cloudId,
        companyName: result.name,
        name: result.name,
        phone: result.phone,
        address1: result.address1,
        address2: result.address2,
        suburb: result.suburb,
        state: result.state,
        postcode: result.postcode,
        country: result.country,
        abn: result.abn,
        website: result.website,
        email: result.email,
      },
      update: {
        companyName: result.name,
      },
    });

    console.log(`${tag} company: synced`);
    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error(`${tag} company: error`, e);
    return false;
  }
}

type CloudHotkeyWithKeys = CloudHotkey & { keys: CloudHotkeyItem[] };

export async function cloudHotkeyMigrateService() {
  try {
    const lastUpdatedAt = await db.cloudHotkey
      .findFirst({
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      })
      .then((r) => r?.updatedAt?.getTime() || 0);

    const { ok, msg, result } = await apiService.post<CloudHotkeyWithKeys[]>(
      "/device/migrate/hotkey/retail",
      { lastUpdatedAt },
    );

    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate hotkeys from cloud",
      );
    }

    for (const hotkey of result) {
      const { keys, ...rest } = hotkey;
      const updatedHotkey = await db.cloudHotkey.upsert({
        where: { id: hotkey.id },
        create: { ...rest },
        update: { ...rest },
        select: { id: true },
      });

      await db.cloudHotkeyItem.deleteMany({
        where: { hotkeyId: updatedHotkey.id },
      });

      await db.cloudHotkeyItem.createMany({
        data: keys.map((key) => ({
          ...key,
          hotkeyId: updatedHotkey.id,
        })),
      });
    }

    console.log(`${tag} hotkeys: ${result.length} synced`);
    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error(`${tag} hotkeys: error`, e);
    return false;
  }
}

export async function normalizeBarcodesService() {
  try {
    const items = await db.item.findMany({
      where: { barcodePLU: null, barcodeGTIN: null },
      select: { id: true, barcode: true },
    });

    let normalized = 0;
    for (const item of items) {
      const { type, gtin14, plu } = getNormalizedBarcode(item.barcode);
      if (gtin14 || plu) normalized++;

      await db.item.update({
        where: { id: item.id },
        data: { barcodeType: type, barcodeGTIN: gtin14, barcodePLU: plu },
      });
    }

    console.log(`${tag} barcodes: ${normalized}/${items.length} normalized`);
    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error(`${tag} barcodes: error`, e);
    return false;
  }
}

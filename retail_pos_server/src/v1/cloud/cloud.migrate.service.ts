import { Brand, Category, Price } from "../../generated/prisma/browser";
import {
  Company,
  Item,
  ItemCategory,
  ItemScaleData,
  PromoPrice,
} from "../../generated/prisma/client";
import { getNormalizedBarcode } from "../../libs/barcode-utils";
import apiService, { itemApiService } from "../../libs/cloud.api";
import db from "../../libs/db";
import { BadRequestException, HttpException } from "../../libs/exceptions";

type ItemWithRelations = Item & {
  scaleData: ItemScaleData | null;
  categories: ItemCategory[];
};

export async function cloudItemMigrateService() {
  try {
    const lastUpdatedAt = await db.item
      .findFirst({
        select: {
          updatedAt: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 1,
      })
      .then((result) => result?.updatedAt?.getTime() || 0);
    const { ok, msg, result } = await itemApiService.post<ItemWithRelations[]>(
      "/device/migrate/item",
      {
        lastUpdatedAt,
      },
    );

    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate items from cloud",
      );
    }

    console.log("Got items from cloud:", result.length, "items");

    // upsert items first.
    for (const item of result) {
      const { scaleData, categories, ...itemData } = item;

      const { barcode } = item;
      const { type, gtin14, plu } = getNormalizedBarcode(barcode);

      await db.item.upsert({
        where: {
          id: item.id,
        },
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
        // remove before

        await db.itemScaleData.deleteMany({
          where: {
            itemId: item.id,
          },
        });

        await db.itemScaleData.create({
          data: {
            ...scaleData,
            itemId: item.id,
          },
        });
      }

      if (categories && categories.length > 0) {
        await db.itemCategory.deleteMany({
          where: {
            itemId: item.id,
          },
        });
        await db.itemCategory.createMany({
          data: categories.map((category) => ({
            itemId: item.id,
            categoryId: category.categoryId,
          })),
        });
      }
      console.log("Upserted item:", item.name_en);
    }

    // connect parent items.
    for (const item of result) {
      await db.item.update({
        where: {
          id: item.id,
        },
        data: {
          parentId: item.parentId,
        },
      });
      console.log("Connected parent item:", item.name_en, "to", item.parentId);
    }

    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("cloudItemMigrateService error:", e);
    return false;
  }
}

export async function cloudCategoryMigrateService() {
  try {
    const lastUpdatedAt = await db.category
      .findFirst({
        select: {
          updatedAt: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 1,
      })
      .then((result) => result?.updatedAt?.getTime() || 0);
    const { ok, msg, result } = await itemApiService.post<Category[]>(
      "/device/migrate/category",
      {
        lastUpdatedAt,
      },
    );

    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate items from cloud",
      );
    }

    console.log("Got categories from cloud:", result.length, "categories");

    const parentCategories = result.filter((category) => !category.parentId);
    const childCategories = result.filter((category) => category.parentId);

    for (const category of parentCategories) {
      await db.category.upsert({
        where: { id: category.id },
        update: {
          ...category,
          parentId: null,
        },
        create: {
          ...category,
          parentId: null,
        },
      });
      console.log("Upserted parent category:", category.name_en);
    }

    for (const category of childCategories) {
      await db.category.upsert({
        where: { id: category.id },
        update: {
          ...category,
          parentId: category.parentId,
        },
        create: {
          ...category,
          parentId: category.parentId,
        },
      });

      console.log("Upserted child category:", category.name_en);
    }

    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("cloudItemMigrateService error:", e);
    return false;
  }
}

export async function cloudBrandMigrateService() {
  try {
    const lastUpdatedAt = await db.brand
      .findFirst({
        select: {
          updatedAt: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 1,
      })
      .then((result) => result?.updatedAt?.getTime() || 0);
    const { ok, msg, result } = await itemApiService.post<Brand[]>(
      "/device/migrate/brand",
      {
        lastUpdatedAt,
      },
    );

    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate brands from cloud",
      );
    }

    console.log("Got brands from cloud:", result.length, "brands");

    for (const brand of result) {
      await db.brand.upsert({
        where: { id: brand.id },
        update: {
          ...brand,
        },
        create: {
          ...brand,
        },
      });
      console.log("Upserted brand:", brand.name_en);
    }

    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("cloudItemMigrateService error:", e);
    return false;
  }
}

export async function cloudPriceMigrateService() {
  try {
    const lastUpdatedAt = await db.price
      .findFirst({
        select: {
          updatedAt: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 1,
      })
      .then((result) => result?.updatedAt?.getTime() || 0);

    const { ok, msg, result } = await apiService.post<Price[]>(
      "/device/migrate/price",
      {
        lastUpdatedAt,
      },
    );

    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate prices from cloud",
      );
    }

    console.log("Got prices from cloud:", result.length, "prices");

    for (const price of result) {
      await db.price.upsert({
        where: { id: price.id },
        update: {
          ...price,
        },
        create: {
          ...price,
        },
      });
      console.log("Upserted price:", price.id);
    }

    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("cloudPriceMigrateService error:", e);
    return false;
  }
}

export async function cloudPromoPriceMigrateService() {
  try {
    const lastUpdatedAt = await db.promoPrice
      .findFirst({
        select: {
          updatedAt: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 1,
      })
      .then((result) => result?.updatedAt?.getTime() || 0);

    const { ok, msg, result } = await apiService.post<PromoPrice[]>(
      "/device/migrate/promo-price",
      {
        lastUpdatedAt,
      },
    );

    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate promo prices from cloud",
      );
    }

    console.log("Got promo prices from cloud:", result.length, "promo prices");

    for (const price of result) {
      await db.promoPrice.upsert({
        where: { id: price.id },
        update: {
          ...price,
        },
        create: {
          ...price,
        },
      });
      console.log("Upserted promo price:", price.id);
    }

    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("cloudPromoPriceMigrateService error:", e);
    return false;
  }
}

export async function cloudCompanyMigrateService() {
  try {
    const { ok, msg, result } = await apiService.get<Company>(
      "/device/migrate/company",
    );
    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate companies from cloud",
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

    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("cloudCompanyMigrateService error:", e);
    return false;
  }
}

export async function normalizeBarcodesService() {
  try {
    const totalCount = await db.item.count({
      where: {
        barcodePLU: null,
        barcodeGTIN: null,
      },
    });
    console.log(`Total items to normalize: ${totalCount}`);
    const items = await db.item.findMany({
      where: {
        barcodePLU: null,
        barcodeGTIN: null,
      },
      select: {
        id: true,
        barcode: true,
      },
    });

    let count = 0;
    for (const item of items) {
      console.log("--------------------------------");
      const { type, gtin14, plu } = getNormalizedBarcode(item.barcode);
      if (gtin14 || plu) {
        count++;
      }
      console.log(item.barcode);
      console.log(type, gtin14, plu);

      await db.item.update({
        where: { id: item.id },
        data: { barcodeType: type, barcodeGTIN: gtin14, barcodePLU: plu },
      });
    }
    console.log(`${count}/${items.length} items updated`);
    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("normalizeBarcodesService error:", e);
    return false;
  }
}

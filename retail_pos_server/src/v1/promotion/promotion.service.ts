import { PromotionWhereInput } from "../../generated/prisma/models";
import db from "../../libs/db";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { FindManyQuery } from "../../libs/query";

export async function getAvailablePromotionsService() {
  try {
    const now = new Date();
    const promotions = await db.promotion.findMany({
      where: {
        startDate: {
          lte: now,
        },
        endDate: {
          gte: now,
        },
      },
    });

    return {
      ok: true,
      result: promotions,
    };
  } catch (error) {
    if (error instanceof HttpException) throw error;
    console.error("Error getting available promotions:", error);
    throw new InternalServerException("Internal server error");
  }
}

export async function searchPromotionsService(query: FindManyQuery) {
  const { keyword = "", page, limit } = query;
  try {
    const kws = keyword
      .split(" ")
      .filter(Boolean)
      .map((kw) => kw.trim());

    const where: PromotionWhereInput = {
      AND: kws.map((kw) => ({
        OR: [
          { name_en: { contains: kw, mode: "insensitive" as const } },
          { name_ko: { contains: kw, mode: "insensitive" as const } },
        ],
      })),
    };

    const totalCount = await db.promotion.count({ where });
    const totalPages = Math.ceil(totalCount / limit);
    const skip = (page - 1) * limit;

    const result = await db.promotion.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ startDate: "desc" }],
    });

    return {
      ok: true,
      result,
      paging: {
        currentPage: page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error searching promotions:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function getPromotionByIdService(id: number) {
  try {
    const promotion = await db.promotion.findUnique({ where: { id } });
    if (!promotion) {
      throw new NotFoundException("Promotion not found");
    }

    const allowedItems = await db.item.findMany({
      where: { id: { in: promotion.allowedItemIds } },
      select: { id: true, name_en: true, barcode: true, uom: true },
    });

    return {
      ok: true,
      result: { ...promotion, allowedItems },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error getting promotion by id:", e);
    throw new InternalServerException("Internal server error");
  }
}

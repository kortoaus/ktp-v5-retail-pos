import { ItemWhereInput } from "../../generated/prisma/models";
import db from "../../libs/db";
import { HttpException, InternalServerException } from "../../libs/exceptions";
import { FindManyQuery } from "../../libs/query";
import { ItemInclude } from "./item.query.option";
import { patchItemPriceService } from "./item.service";

export async function searchItemsService(query: FindManyQuery) {
  const { keyword = "", page, limit } = query;
  try {
    const kws = keyword
      .split(" ")
      .filter(Boolean)
      .map((kw) => kw.trim());

    const where: ItemWhereInput = {
      archived: false,
      AND: kws.map((kw) => ({
        OR: [
          { barcode: { contains: kw, mode: "insensitive" as const } },
          { name_en: { contains: kw, mode: "insensitive" as const } },
          { name_ko: { contains: kw, mode: "insensitive" as const } },
          { name_invoice: { contains: kw, mode: "insensitive" as const } },
          {
            brand: { name_en: { contains: kw, mode: "insensitive" as const } },
          },
          {
            brand: { name_ko: { contains: kw, mode: "insensitive" as const } },
          },
        ],
      })),
    };

    const totalCount = await db.item.count({ where });
    const totalPages = Math.ceil(totalCount / limit);
    const skip = (page - 1) * limit;

    const result = await db.item.findMany({
      where,
      skip,
      include: ItemInclude,
      take: limit,
      orderBy: [{ barcode: "asc" }],
    });

    const resultWithPrices = await patchItemPriceService(result);

    return {
      ok: true,
      result: resultWithPrices,
      paging: {
        currentPage: page,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error searching items:", e);
    throw new InternalServerException("Internal server error");
  }
}

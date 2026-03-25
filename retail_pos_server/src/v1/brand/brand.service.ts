import { BrandWhereInput, ItemWhereInput } from "../../generated/prisma/models";
import db from "../../libs/db";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { FindManyQuery } from "../../libs/query";

export async function searchBrandsService(query: FindManyQuery) {
  const { keyword = "", page, limit } = query;
  try {
    const kws = keyword
      .split(" ")
      .filter(Boolean)
      .map((kw) => kw.trim());

    const where: BrandWhereInput = {
      archived: false,
      AND: kws.map((kw) => ({
        OR: [
          { name_en: { contains: kw, mode: "insensitive" as const } },
          { name_ko: { contains: kw, mode: "insensitive" as const } },
        ],
      })),
    };

    const totalCount = await db.brand.count({ where });
    const totalPages = Math.ceil(totalCount / limit);
    const skip = (page - 1) * limit;

    const result = await db.brand.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ name_en: "asc" }, { name_ko: "asc" }],
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
    console.error("Error searching items:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function searchBrandByIdService(id: number) {
  try {
    const result = await db.brand.findFirst({
      where: { id, archived: false },
    });
    if (!result) {
      throw new NotFoundException("Item not found");
    }

    return { ok: true, result, msg: "Success" };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error searching brand by id:", e);
    throw new InternalServerException("Internal server error");
  }
}

import { Prisma } from "../../generated/prisma/client";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { FindManyQuery } from "../../libs/query";

export const getUserByCodeService = async (code: string) => {
  try {
    const result = await db.user.findFirst({
      where: {
        code,
        archived: false,
      },
    });

    if (!result) {
      throw new NotFoundException("User not found");
    }

    return { ok: true, result, msg: "User found" };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getUserByCodeService error:", e);
    throw new InternalServerException();
  }
};

type UpsertUserDTO = {
  id?: number;
  name: string;
  scope: string[];
  code: string;
  archived: boolean;
};

export const upsertUserService = async (dto: UpsertUserDTO) => {
  const { id, name, scope, code, archived } = dto;

  if (id === 1) {
    throw new BadRequestException("You cannot update the admin user");
  }

  try {
    const exist = await db.user.findFirst({
      where: {
        code,
        archived: false,
      },
    });

    if (exist) {
      if (typeof id === "number") {
        if (exist?.id !== id) {
          throw new BadRequestException("User code already exists");
        }
      } else {
        throw new BadRequestException("User code already exists");
      }
    }

    const result = await db.user.upsert({
      where: {
        id: id ?? 0,
      },
      update: {
        name,
        code,
        scope,
        archived,
      },
      create: {
        name,
        scope,
        code,
        archived: false,
      },
    });

    return { ok: true, result, msg: "User upserted successfully" };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("upsertUserService error:", e);
    throw new InternalServerException();
  }
};

function buildUserKeywordFilter(keyword: string | undefined) {
  if (!keyword) return undefined;

  const words = keyword.split(" ").filter(Boolean);
  if (words.length === 0) return undefined;

  return {
    AND: words.map((word) => ({
      OR: [
        { name: { contains: word, mode: "insensitive" as const } },
        { code: { contains: word, mode: "insensitive" as const } },
      ],
    })),
  };
}

export async function getUserByIdService(id: number) {
  try {
    const result = await db.user.findUnique({
      where: { id },
    });

    if (!result) {
      throw new NotFoundException("User not found");
    }

    return { ok: true, result, msg: "User found" };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getUserByIdService error:", e);
    throw new InternalServerException();
  }
}

export async function getUsersService(query: FindManyQuery) {
  const { keyword, page, limit } = query;

  try {
    const where: Prisma.UserWhereInput = {
      ...buildUserKeywordFilter(keyword),
      id: {
        not: 1,
      },
    };

    const totalCount = await db.user.count({ where });
    const totalPages = Math.ceil(totalCount / limit);
    const skip = (page - 1) * limit;

    const result = await db.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ archived: "desc" }, { id: "asc" }],
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
    console.error("getUsersService error:", e);
    throw new InternalServerException();
  }
}

import { Terminal, TerminalShift, User } from "../../generated/prisma/client";
import { CashInOutWhereInput } from "../../generated/prisma/models";
import db from "../../libs/db";
import { numberifyCashInOut } from "../../libs/decimal-utils";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { FindManyQuery } from "../../libs/query";

type CashInOutDTO = {
  type: string;
  amount: number;
  note?: string;
};

export async function createCashIOService(
  shift: TerminalShift,
  terminal: Terminal,
  user: User,
  dto: CashInOutDTO,
) {
  try {
    if (!shift) throw new NotFoundException("Shift not found");
    if (!terminal) throw new NotFoundException("Terminal not found");
    if (!user) throw new NotFoundException("User not found");

    const cashInOut = await db.cashInOut.create({
      data: {
        shiftId: shift.id,
        terminalId: terminal.id,
        userId: user.id,
        userName: user.name,
        type: dto.type.toLowerCase(),
        amount: dto.amount,
        note: dto.note,
      },
      select: {
        id: true,
      },
    });

    return { ok: true, msg: "Cash in out created", result: cashInOut.id };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("createCashInOutService error:", e);
    throw new InternalServerException();
  }
}

export async function getCashIOsService(query: FindManyQuery) {
  const { keyword = "", page, limit, from, to } = query;
  try {
    const kws = keyword
      .split(" ")
      .filter(Boolean)
      .map((kw) => kw.trim());

    const where: CashInOutWhereInput = {
      AND: kws.map((kw) => ({
        OR: [
          { userName: { contains: kw, mode: "insensitive" as const } },
          { note: { contains: kw, mode: "insensitive" as const } },
        ],
      })),
    };

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const totalCount = await db.cashInOut.count({ where });
    const totalPages = Math.ceil(totalCount / limit);
    const skip = (page - 1) * limit;

    const result = await db.cashInOut
      .findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      })
      .then((r) => r.map(numberifyCashInOut));

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
    console.error("getCashIOsService error:", e);
    throw new InternalServerException();
  }
}

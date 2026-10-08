import { Terminal, TerminalShift, User } from "../../generated/prisma/client";
import { CashInOutWhereInput } from "../../generated/prisma/models";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { FindManyQuery } from "../../libs/query";
import { assertShiftOpenInTx } from "../shift/shift.lock";

// R-9 — CashInOut.type is a free string column whose only readers expect
// "in" | "out" (shift.service close totals). The amount is unsigned cents; the
// direction lives in `type`, so a signed amount would double-flip the drawer.
export function parseCashIODto(body: unknown): {
  type: "in" | "out";
  amount: number;
  note?: string;
} {
  if (body == null || typeof body !== "object")
    throw new BadRequestException("Invalid cash in/out payload");
  const { type, amount, note } = body as Record<string, unknown>;
  if (type !== "in" && type !== "out")
    throw new BadRequestException('type must be "in" or "out"');
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0)
    throw new BadRequestException("amount must be a positive integer (cents)");
  if (note != null && typeof note !== "string")
    throw new BadRequestException("note must be a string");
  return { type, amount, note: note ?? undefined };
}

export async function createCashIOService(
  shift: TerminalShift,
  terminal: Terminal,
  user: User,
  body: unknown,
) {
  try {
    const dto = parseCashIODto(body);
    if (!shift) throw new NotFoundException("Shift not found");
    if (!terminal) throw new NotFoundException("Terminal not found");
    if (!user) throw new NotFoundException("User not found");

    // T-24 (R-7) — under the shift row lock so a close cannot miss it.
    const cashInOut = await db.$transaction(async (tx) => {
      await assertShiftOpenInTx(tx, shift.id, "cash in/out");
      return tx.cashInOut.create({
        data: {
          shiftId: shift.id,
          terminalId: terminal.id,
          userId: user.id,
          userName: user.name,
          type: dto.type,
          amount: dto.amount,
          note: dto.note,
        },
        select: {
          id: true,
        },
      });
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
;

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

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
import { isUniqueViolation } from "../../libs/prisma-errors";
import { assertShiftOpenInTx } from "../shift/shift.lock";
import {
  operationConflict,
  operationPayloadHash,
  resolveOperationId,
  withOperationClaim,
} from "../sale/sale.operation";

// R-9 — CashInOut.type is a free string column whose only readers expect
// "in" | "out" (shift.service close totals). The amount is unsigned cents; the
// direction lives in `type`, so a signed amount would double-flip the drawer.
export function parseCashIODto(body: unknown): CashIODto {
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

// T-10 (retail-runner, F-27) — operation identity, the sale discipline
// (sale.operation.ts): the till sends its Cash In/Out attempt `operationId`
// and resends it on every retry until the server answers. Stored on
// CashInOut.operationId (@unique) with a hash of the parsed { type, amount, note }:
//   - same id + same hash  → the recorded row's id again, `replayed: true`
//   - same id + other hash → 409 OPERATION_PAYLOAD_MISMATCH (attempt ends)
//   - no id (older till)   → server-minted, works as before (no idempotency).
export interface CashIODto {
  type: "in" | "out";
  amount: number;
  note?: string;
}

export interface RecordedCashIO {
  id: number;
  terminalId: number;
  operationPayloadHash: string | null;
}

export interface PersistCashIOArgs {
  shift: TerminalShift;
  terminal: Terminal;
  user: User;
  dto: CashIODto;
  operationId: string;
  payloadHash: string;
}

export interface CashIOCreateDeps {
  findByOperationId(operationId: string): Promise<RecordedCashIO | null>;
  persist(args: PersistCashIOArgs): Promise<{ id: number }>;
}

export const defaultCashIOCreateDeps: CashIOCreateDeps = {
  findByOperationId: (operationId) =>
    db.cashInOut.findUnique({
      where: { operationId },
      select: { id: true, terminalId: true, operationPayloadHash: true },
    }),
  // T-24 (R-7) — under the shift row lock so a close cannot miss it.
  persist: ({ shift, terminal, user, dto, operationId, payloadHash }) =>
    db.$transaction(async (tx) => {
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
          operationId,
          operationPayloadHash: payloadHash,
        },
        select: { id: true },
      });
    }),
};

function assertSameCashIOPayload(
  recorded: RecordedCashIO,
  payloadHash: string,
  terminal: Terminal,
) {
  // Scope: a replay answers only the terminal that recorded the entry.
  if (recorded.terminalId !== terminal.id)
    throw operationConflict(
      "This operationId was recorded by another terminal (409). Pressing Submit again records a new entry.",
    );
  if (recorded.operationPayloadHash !== payloadHash)
    throw operationConflict(
      `This Cash In/Out attempt was already recorded as entry #${recorded.id} with a different type, amount or note (409). Check the Cash In/Out list before saving again; pressing Submit again records a new entry.`,
    );
}

// `shift` is the terminal's open shift or null: a replay of a recorded entry
// needs none (the shift may have closed since the lost answer); a new entry
// does (404 "Shift not found", as before).
export async function createCashIOService(
  shift: TerminalShift | null,
  terminal: Terminal,
  user: User,
  body: unknown,
  deps: CashIOCreateDeps = defaultCashIOCreateDeps,
) {
  try {
    const dto = parseCashIODto(body);
    if (!terminal) throw new NotFoundException("Terminal not found");
    if (!user) throw new NotFoundException("User not found");

    const { operationId } = resolveOperationId(
      (body as Record<string, unknown>).operationId,
      "cashio",
    );
    const payloadHash = operationPayloadHash(dto);

    const replay = (recorded: RecordedCashIO, replayed: boolean) => {
      assertSameCashIOPayload(recorded, payloadHash, terminal);
      return {
        ok: true,
        msg: replayed
          ? "Cash in out already recorded — returning the original entry"
          : "Cash in out created",
        result: recorded.id,
        replayed,
      };
    };

    return await withOperationClaim(operationId, async () => {
      const recorded = await deps.findByOperationId(operationId);
      if (recorded) return replay(recorded, true);

      // Only a NEW entry needs the open shift (T-10 review fix).
      if (!shift) throw new NotFoundException("Shift not found");

      try {
        const cashInOut = await deps.persist({
          shift,
          terminal,
          user,
          dto,
          operationId,
          payloadHash,
        });
        return { ok: true, msg: "Cash in out created", result: cashInOut.id, replayed: false };
      } catch (persistenceError) {
        // A persistence error does not prove nothing committed (lost COMMIT
        // ack, or a racing request took the unique id): look before answering.
        let after: RecordedCashIO | null = null;
        try {
          after = await deps.findByOperationId(operationId);
        } catch (lookupError) {
          console.error("[sale-operation] cash in/out lookup after a persistence error failed", lookupError);
        }
        if (after) return replay(after, isUniqueViolation(persistenceError));
        throw persistenceError;
      }
    });
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

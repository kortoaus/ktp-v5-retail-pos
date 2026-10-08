import type { Prisma } from "../../generated/prisma/client";
import { BadRequestException } from "../../libs/exceptions";

// T-24 (audit R-7) — shift close and the financial writers meet on the
// TerminalShift row.
//
//   close   : one transaction — `SELECT … FOR UPDATE` on the shift row,
//             re-check closedAt, aggregate, set closedAt + totals.
//   writers : sale / spend / refund / repay / cash in-out take the same row
//             `FOR SHARE` as the FIRST statement of their write transaction
//             and re-check closedAt; a closed shift answers the existing
//             "No open shift — … cannot be created" 400.
//
// FOR SHARE (writer) and FOR UPDATE (close) conflict, writers do not conflict
// with each other. So a writer that locked first commits before close can
// aggregate (its invoice is counted), and a writer that arrives after close
// locked waits, then sees closedAt and is rejected — never a closed shift with
// an uncounted sale. The shift context the middleware read before the
// transaction is only a hint; this lock is the decision.
//
// Lock order (deadlock-free because everyone takes them in this order):
//   1. TerminalShift row        (this file)
//   2. original SaleInvoice row (refund / repay, lockOriginalInvoiceInTx)
//   3. DocCounter row           (nextDocCounter upsert)
// Shift close takes only (1) and reads the rest.

export type ShiftLockMode = "share" | "update";

export interface ShiftLockRow {
  id: number;
  closedAt: Date | null;
}

export async function lockShiftRowInTx(
  tx: Prisma.TransactionClient,
  shiftId: number,
  mode: ShiftLockMode,
): Promise<ShiftLockRow | null> {
  const rows =
    mode === "update"
      ? await tx.$queryRaw<ShiftLockRow[]>`
          SELECT "id", "closedAt" FROM "TerminalShift" WHERE "id" = ${shiftId} FOR UPDATE
        `
      : await tx.$queryRaw<ShiftLockRow[]>`
          SELECT "id", "closedAt" FROM "TerminalShift" WHERE "id" = ${shiftId} FOR SHARE
        `;
  return rows[0] ?? null;
}

export type ShiftWriteKind = "sale" | "spend" | "refund" | "repay" | "cash in/out";

export function shiftClosedError(what: ShiftWriteKind): BadRequestException {
  return new BadRequestException(`No open shift — ${what} cannot be created`);
}

// First statement of every financial write transaction.
export async function assertShiftOpenInTx(
  tx: Prisma.TransactionClient,
  shiftId: number,
  what: ShiftWriteKind,
): Promise<void> {
  const row = await lockShiftRowInTx(tx, shiftId, "share");
  if (!row || row.closedAt != null) throw shiftClosedError(what);
}

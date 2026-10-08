import db from "../../libs/db";
import { InternalServerException } from "../../libs/exceptions";
import type { Prisma } from "../../generated/prisma/client";
import { isUniqueViolation } from "../../libs/prisma-errors";
import type {
  CustomerVoucherOperationKind,
  CustomerVoucherOperationStatus,
} from "../../generated/prisma/enums";

// Durable local ledger of customer-voucher CRM effects (T-15, platform/D-10).
// Schema + state meanings: prisma/schema.prisma `CustomerVoucherOperation`.
// The services take this interface so tests can run on an in-memory fake.

export type CvOperationKind = CustomerVoucherOperationKind;
export type CvOperationStatus = CustomerVoucherOperationStatus;

export interface CvOperationRow {
  id: number;
  operationId: string;
  kind: CvOperationKind;
  voucherId: number | null;
  memberId: string | null;
  amount: number;
  crmRequestId: string;
  status: CvOperationStatus;
  invoiceId: number | null;
  crmEventId: number | null;
  crmVoucherId: number | null;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CvOperationIntent {
  operationId: string;
  kind: CvOperationKind;
  voucherId: number | null;
  memberId: string | null;
  amount: number;
  crmRequestId: string;
}

export interface CvOperationPatch {
  status?: CvOperationStatus;
  voucherId?: number | null;
  invoiceId?: number | null;
  crmEventId?: number | null;
  crmVoucherId?: number | null;
  lastError?: string | null;
  // +1 per CRM call made for this row.
  attempted?: boolean;
}

// Primary kinds carry the money effect; VOID_* rows are the audit trail of
// the voids sent for them.
export const PRIMARY_KINDS: CvOperationKind[] = ["REDEEM", "REFUND_ISSUE"];
// "Open" = needs the reconciler: INTENT, UNRESOLVED, or CONFIRMED without an invoice.
export const OPEN_STATUSES: CvOperationStatus[] = ["INTENT", "CONFIRMED", "UNRESOLVED"];

export function isOpenRow(row: Pick<CvOperationRow, "kind" | "status" | "invoiceId">) {
  return (
    PRIMARY_KINDS.includes(row.kind) &&
    (row.status === "INTENT" ||
      row.status === "UNRESOLVED" ||
      (row.status === "CONFIRMED" && row.invoiceId == null))
  );
}

export interface CustomerVoucherOperationStore {
  findByOperationId(operationId: string): Promise<CvOperationRow[]>;
  findByCrmRequestId(crmRequestId: string): Promise<CvOperationRow | null>;
  // Create the INTENT row (committed before any CRM call). An existing row is
  // returned as is, except FAILED (CRM did nothing) which goes back to INTENT.
  ensureIntent(intent: CvOperationIntent): Promise<CvOperationRow>;
  update(id: number, patch: CvOperationPatch): Promise<CvOperationRow>;
  // Open primary rows last touched before `olderThan`.
  listForReconcile(olderThan: Date): Promise<CvOperationRow[]>;
  list(statuses: CvOperationStatus[], limit: number): Promise<CvOperationRow[]>;
  countOpen(): Promise<number>;
}

function toData(patch: CvOperationPatch) {
  const { attempted, ...rest } = patch;
  return {
    ...rest,
    ...(attempted ? { attempts: { increment: 1 } } : {}),
  };
}

const openWhere = {
  kind: { in: PRIMARY_KINDS },
  OR: [
    { status: { in: ["INTENT", "UNRESOLVED"] as CvOperationStatus[] } },
    { status: "CONFIRMED" as CvOperationStatus, invoiceId: null },
  ],
};

export const prismaCvOperationStore: CustomerVoucherOperationStore = {
  findByOperationId(operationId) {
    return db.customerVoucherOperation.findMany({
      where: { operationId },
      orderBy: { id: "asc" },
    });
  },
  findByCrmRequestId(crmRequestId) {
    return db.customerVoucherOperation.findUnique({ where: { crmRequestId } });
  },
  async ensureIntent(intent) {
    const existing = await db.customerVoucherOperation.findUnique({
      where: { crmRequestId: intent.crmRequestId },
    });
    if (existing) {
      if (existing.status !== "FAILED") return existing;
      return db.customerVoucherOperation.update({
        where: { id: existing.id },
        data: { status: "INTENT", lastError: null },
      });
    }
    try {
      return await db.customerVoucherOperation.create({
        data: { ...intent, status: "INTENT" },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const raced = await db.customerVoucherOperation.findUnique({
        where: { crmRequestId: intent.crmRequestId },
      });
      if (!raced) throw e;
      return raced;
    }
  },
  update(id, patch) {
    return db.customerVoucherOperation.update({
      where: { id },
      data: toData(patch),
    });
  },
  listForReconcile(olderThan) {
    return db.customerVoucherOperation.findMany({
      where: { ...openWhere, updatedAt: { lt: olderThan } },
      orderBy: { id: "asc" },
      take: 200,
    });
  },
  list(statuses, limit) {
    return db.customerVoucherOperation.findMany({
      where: { status: { in: statuses } },
      orderBy: { id: "desc" },
      take: limit,
    });
  },
  countOpen() {
    return db.customerVoucherOperation.count({ where: openWhere });
  },
};

// Inside the local sale/refund transaction: CONFIRMED rows → LINKED with the
// new invoice id. A row that is no longer CONFIRMED (e.g. voided meanwhile)
// aborts the transaction, so no invoice is ever written against a voided debit.
export async function linkOperationRowsInTx(
  tx: Prisma.TransactionClient,
  rowIds: number[],
  invoiceId: number,
) {
  if (rowIds.length === 0) return;
  const { count } = await tx.customerVoucherOperation.updateMany({
    where: { id: { in: rowIds }, status: "CONFIRMED", invoiceId: null },
    data: { status: "LINKED", invoiceId },
  });
  if (count !== rowIds.length)
    throw new InternalServerException(
      "Customer voucher ledger changed while saving — nothing was recorded",
    );
}

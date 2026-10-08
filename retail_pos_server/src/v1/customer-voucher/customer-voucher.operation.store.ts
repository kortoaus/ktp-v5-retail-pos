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
  transientFailures: number;
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
  // +1 attempts: CRM answered (ok or a definitive refusal). This is the
  // UNRESOLVED_MANUAL budget (F-12).
  attempted?: boolean;
  // +1 transientFailures: no answer (timeout / transport / 5xx). Visibility
  // only — never counts toward the budget, never terminal (F-12).
  transient?: boolean;
}

// Primary kinds carry the money effect; VOID_* rows are the audit trail of
// the voids sent for them.
export const PRIMARY_KINDS: CvOperationKind[] = ["REDEEM", "REFUND_ISSUE"];
// "Reconcilable" = the sweep works it: INTENT, UNRESOLVED, or CONFIRMED
// without an invoice. "Open" (operations endpoint default, Close Shift
// warning) additionally counts UNRESOLVED_MANUAL — given up on by the sweep
// after MAX_RECONCILE_ATTEMPTS, left for a person (F-10).
export const OPEN_STATUSES: CvOperationStatus[] = [
  "INTENT",
  "CONFIRMED",
  "UNRESOLVED",
  "UNRESOLVED_MANUAL",
];

export const VOID_KINDS: CvOperationKind[] = ["VOID_REDEEM", "VOID_REFUND_ISSUE"];

// F-11 — a void whose outcome is not known yet (INTENT before / UNRESOLVED
// after the CRM call). While one exists its primary can never become payment.
export function isPendingVoidRow(row: Pick<CvOperationRow, "kind" | "status">) {
  return (
    VOID_KINDS.includes(row.kind) &&
    (row.status === "INTENT" || row.status === "UNRESOLVED")
  );
}

export function isReconcilableRow(row: Pick<CvOperationRow, "kind" | "status" | "invoiceId">) {
  return (
    isPendingVoidRow(row) ||
    (PRIMARY_KINDS.includes(row.kind) &&
      (row.status === "INTENT" ||
        row.status === "UNRESOLVED" ||
        (row.status === "CONFIRMED" && row.invoiceId == null)))
  );
}

export function isOpenRow(row: Pick<CvOperationRow, "kind" | "status" | "invoiceId">) {
  return isReconcilableRow(row) || (PRIMARY_KINDS.includes(row.kind) && row.status === "UNRESOLVED_MANUAL");
}

export interface CustomerVoucherOperationStore {
  findByOperationId(operationId: string): Promise<CvOperationRow[]>;
  findByCrmRequestId(crmRequestId: string): Promise<CvOperationRow | null>;
  // Create the INTENT row (committed before any CRM call). An existing row is
  // returned as is, except FAILED (CRM did nothing) which goes back to INTENT.
  ensureIntent(intent: CvOperationIntent): Promise<CvOperationRow>;
  update(id: number, patch: CvOperationPatch): Promise<CvOperationRow>;
  // Reconcilable primary rows last touched before `olderThan`, least recently
  // touched first (every attempt touches updatedAt, so stuck rows rotate to
  // the back — F-10), at most `limit`.
  listForReconcile(olderThan: Date, limit: number): Promise<CvOperationRow[]>;
  list(statuses: CvOperationStatus[], limit: number): Promise<CvOperationRow[]>;
  countOpen(): Promise<number>;
}

function toData(patch: CvOperationPatch) {
  const { attempted, transient, ...rest } = patch;
  return {
    ...rest,
    ...(attempted ? { attempts: { increment: 1 } } : {}),
    ...(transient ? { transientFailures: { increment: 1 } } : {}),
  };
}

const reconcilableWhere = {
  OR: [
    { status: { in: ["INTENT", "UNRESOLVED"] as CvOperationStatus[] } }, // primary or void
    {
      kind: { in: PRIMARY_KINDS },
      status: "CONFIRMED" as CvOperationStatus,
      invoiceId: null,
    },
  ],
};

const openWhere = {
  kind: { in: PRIMARY_KINDS },
  OR: [
    { status: { in: ["INTENT", "UNRESOLVED", "UNRESOLVED_MANUAL"] as CvOperationStatus[] } },
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
  listForReconcile(olderThan, limit) {
    return db.customerVoucherOperation.findMany({
      where: { ...reconcilableWhere, updatedAt: { lt: olderThan } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit,
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

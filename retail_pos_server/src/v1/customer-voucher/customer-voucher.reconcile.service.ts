import db from "../../libs/db";
import { claimOperation, releaseOperation } from "../sale/sale.operation";
import type { CrmOutcome, CrmOperationState } from "./customer-voucher.crm";
import {
  defaultCvDeps,
  REFUND_ISSUE_ENTITY_TYPE,
  voidRedeemRow,
  voidRefundIssueRow,
  voidRequestIdFor,
  type CvDeps,
  type VoidResult,
} from "./customer-voucher.operation";
import {
  isPendingVoidRow,
  isReconcilableRow,
  type CvOperationRow,
} from "./customer-voucher.operation.store";

// ══════════════════════════════════════════════════════════════════════════════
// Customer-voucher reconciler (T-15, platform/D-10 — R-4/V-2, V-12)
//
// Runs at boot and every 5 minutes over open primary ledger rows (INTENT,
// UNRESOLVED, CONFIRMED without invoice) untouched for 2+ minutes. For each it
// asks CRM for the effective state of its key (GET /device/customer-voucher/
// operation) — never trusting a redeem replay — and settles it:
//   REDEEM        not_found → FAILED (nothing happened)
//                 voided    → VOIDED
//                 redeemed  → local invoice with this operationId that carries
//                             this voucher + amount ? LINKED
//                             : void the redeem → VOIDED (UNRESOLVED if the void fails)
//   REFUND_ISSUE  not_found → FAILED; issue_voided → VOIDED
//                 issued    → local REFUND invoice carrying the issued voucher +
//                             amount ? LINKED : void → VOIDED
//   CRM unreachable → attempts+1, lastError, row stays as it is.
// Each operation is claimed (sale.operation.ts) while it is worked, so a till
// retrying the same operationId cannot race the reconciler.
//
// Scheduling: one run in flight; a trigger during a run sets a rerun flag and
// the run loops once more (not the R-5 drop-while-running pattern).
// ══════════════════════════════════════════════════════════════════════════════

export const RECONCILE_MIN_AGE_MS = 2 * 60 * 1000;
export const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
export const RECONCILE_BATCH = 200;
// F-10 — a row CRM keeps answering about but that still cannot be settled
// (e.g. a refund voucher already spent) leaves the sweep after this many
// attempts as UNRESOLVED_MANUAL (still counted open). CRM being unreachable
// never moves a row there.
export const MAX_RECONCILE_ATTEMPTS = 50;

export interface ReconcileInvoice {
  id: number;
  type: string;
  payments: Array<{
    type: string;
    amount: number;
    entityType: string | null;
    entityId: number | null;
  }>;
}

export interface ReconcileDeps extends CvDeps {
  findInvoiceByOperationId(operationId: string): Promise<ReconcileInvoice | null>;
  now(): Date;
  batchSize?: number;
}

// F-6 — an Invoice under the same operationId proves nothing by itself; it
// must carry this effect's customer-voucher tender (same voucher, same amount).
export function invoiceCarriesVoucher(
  invoice: ReconcileInvoice | null,
  type: "SALE" | "REFUND",
  voucherId: number | null,
  amount: number,
): invoice is ReconcileInvoice {
  return (
    invoice != null &&
    invoice.type === type &&
    voucherId != null &&
    invoice.payments.some(
      (p) =>
        p.type === "VOUCHER" &&
        p.entityType === "customer-voucher" &&
        p.entityId === voucherId &&
        p.amount === amount,
    )
  );
}

export const defaultReconcileDeps: ReconcileDeps = {
  ...defaultCvDeps,
  findInvoiceByOperationId: (operationId) =>
    db.saleInvoice.findUnique({
      where: { operationId },
      select: {
        id: true,
        type: true,
        payments: {
          select: { type: true, amount: true, entityType: true, entityId: true },
        },
      },
    }),
  now: () => new Date(),
};

export type ReconcileResult =
  | "linked"
  | "voided"
  | "failed"
  | "unresolved"
  | "unreachable"
  | "skipped";

export interface ReconcileSummary {
  checked: number;
  linked: number;
  voided: number;
  failed: number;
  unresolved: number;
  unreachable: number;
  skipped: number;
}

// F-12 — only a CRM answer that leaves the primary unsettled (void refused)
// counts toward the UNRESOLVED_MANUAL budget; a void that got no answer is
// transient ("unreachable"), retried next sweep forever.
async function voidResultOf(
  row: CvOperationRow,
  result: VoidResult,
  deps: ReconcileDeps,
): Promise<ReconcileResult> {
  if (result === "VOIDED") return "voided";
  await deps.ops.update(
    row.id,
    result === "REJECTED" ? { attempted: true } : { transient: true },
  );
  return result === "REJECTED" ? "unresolved" : "unreachable";
}

// F-11 — settle a void whose outcome is unknown BEFORE its primary may be
// linked or voided: ask CRM for the primary's state; voided → done;
// not_found → nothing ever happened; still effective → re-send the same void
// (same requestId, idempotent at CRM).
async function reconcileVoidRow(
  voidRow: CvOperationRow,
  primary: CvOperationRow | undefined,
  deps: ReconcileDeps,
): Promise<ReconcileResult> {
  if (!primary) {
    await deps.ops.update(voidRow.id, {
      status: "UNRESOLVED",
      attempted: true,
      lastError: "reconcile: primary ledger row missing",
    });
    return "unresolved";
  }
  const isRefund = voidRow.kind === "VOID_REFUND_ISSUE";
  let outcome: CrmOutcome<CrmOperationState>;
  try {
    outcome = await deps.crm.getOperation(
      primary.crmRequestId,
      isRefund ? REFUND_ISSUE_ENTITY_TYPE : undefined,
    );
  } catch (e) {
    outcome = { kind: "unknown", status: 0, msg: String(e) };
  }
  if (outcome.kind !== "ok") {
    await deps.ops.update(voidRow.id, {
      transient: true,
      lastError: `reconcile: CRM ${outcome.kind} ${outcome.status}: ${outcome.msg}`.slice(0, 500),
    });
    return "unreachable";
  }
  const { state } = outcome.result;
  if (state === (isRefund ? "issue_voided" : "voided")) {
    await deps.ops.update(voidRow.id, { status: "CONFIRMED", attempted: true, lastError: null });
    await deps.ops.update(primary.id, { status: "VOIDED", lastError: null });
    return "voided";
  }
  if (state === "not_found") {
    await deps.ops.update(voidRow.id, {
      status: "FAILED",
      attempted: true,
      lastError: "reconcile: nothing to void (CRM has no event)",
    });
    await deps.ops.update(primary.id, {
      status: "FAILED",
      lastError: "reconcile: CRM has no event for this key (nothing happened)",
    });
    return "failed";
  }
  const reason = "reconcile: re-sending a void whose answer was lost";
  return voidResultOf(
    primary,
    isRefund
      ? await voidRefundIssueRow(primary, reason, deps)
      : await voidRedeemRow(primary, reason, deps),
    deps,
  );
}

async function reconcileRow(
  row: CvOperationRow,
  deps: ReconcileDeps,
): Promise<ReconcileResult> {
  let outcome: CrmOutcome<CrmOperationState>;
  try {
    outcome = await deps.crm.getOperation(
      row.crmRequestId,
      row.kind === "REFUND_ISSUE" ? REFUND_ISSUE_ENTITY_TYPE : undefined,
    );
  } catch (e) {
    outcome = { kind: "unknown", status: 0, msg: String(e) };
  }
  if (outcome.kind !== "ok") {
    await deps.ops.update(row.id, {
      transient: true, // F-12: no answer never counts toward the budget
      lastError: `reconcile: CRM ${outcome.kind} ${outcome.status}: ${outcome.msg}`.slice(0, 500),
    });
    return "unreachable";
  }

  const { state, eventId, voucherId } = outcome.result;
  const invoice = await deps.findInvoiceByOperationId(row.operationId);

  if (state === "not_found") {
    await deps.ops.update(row.id, {
      status: "FAILED",
      attempted: true,
      lastError: "reconcile: CRM has no event for this key (nothing happened)",
    });
    return "failed";
  }

  if (row.kind === "REDEEM") {
    if (state === "voided") {
      await deps.ops.update(row.id, { status: "VOIDED", attempted: true, lastError: null });
      return "voided";
    }
    if (state === "redeemed") {
      if (invoiceCarriesVoucher(invoice, "SALE", voucherId ?? row.voucherId, row.amount)) {
        await deps.ops.update(row.id, {
          status: "LINKED",
          invoiceId: invoice.id,
          crmEventId: eventId,
          attempted: true,
          lastError: null,
        });
        return "linked";
      }
      return voidResultOf(
        row,
        await voidRedeemRow(row, "reconcile: CRM redeem without a local invoice carrying it", deps),
        deps,
      );
    }
  }

  if (row.kind === "REFUND_ISSUE") {
    if (state === "issue_voided") {
      await deps.ops.update(row.id, { status: "VOIDED", attempted: true, lastError: null });
      return "voided";
    }
    if (state === "issued") {
      if (
        invoiceCarriesVoucher(
          invoice,
          "REFUND",
          voucherId ?? row.crmVoucherId,
          row.amount,
        )
      ) {
        await deps.ops.update(row.id, {
          status: "LINKED",
          invoiceId: invoice.id,
          voucherId: voucherId ?? row.voucherId,
          crmVoucherId: voucherId ?? row.crmVoucherId,
          crmEventId: eventId,
          attempted: true,
          lastError: null,
        });
        return "linked";
      }
      return voidResultOf(
        row,
        await voidRefundIssueRow(
          row,
          "reconcile: CRM refund issue without a local refund invoice carrying it",
          deps,
        ),
        deps,
      );
    }
  }

  await deps.ops.update(row.id, {
    status: "UNRESOLVED",
    attempted: true,
    lastError: `reconcile: unexpected CRM state ${state} for ${row.kind}`,
  });
  return "unresolved";
}

export async function reconcileCustomerVoucherOperations(
  deps: ReconcileDeps = defaultReconcileDeps,
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    checked: 0,
    linked: 0,
    voided: 0,
    failed: 0,
    unresolved: 0,
    unreachable: 0,
    skipped: 0,
  };
  const olderThan = new Date(deps.now().valueOf() - RECONCILE_MIN_AGE_MS);
  // F-14 — two selections with separate capacity: pending voids, then
  // primaries with no pending void (a blocked primary never fills the batch).
  const batch = deps.batchSize ?? RECONCILE_BATCH;
  const rows = [
    ...(await deps.ops.listPendingVoids(olderThan, batch)),
    ...(await deps.ops.listReconcilablePrimaries(olderThan, batch)),
  ];

  const byOperation = new Map<string, CvOperationRow[]>();
  for (const row of rows) {
    const list = byOperation.get(row.operationId) ?? [];
    list.push(row);
    byOperation.set(row.operationId, list);
  }

  for (const [operationId, opRows] of byOperation) {
    if (!claimOperation(operationId)) {
      summary.skipped += opRows.length;
      continue;
    }
    try {
      // F-11 — voids first; a primary with a void still pending is not touched.
      const voidRows = opRows.filter(isPendingVoidRow);
      let all = await deps.ops.findByOperationId(operationId);
      for (const voidRow of voidRows) {
        summary.checked += 1;
        const primaryKey = voidRow.crmRequestId.replace(/:void$/, "");
        try {
          summary[await reconcileVoidRow(voidRow, all.find((r) => r.crmRequestId === primaryKey), deps)] += 1;
        } catch (e) {
          summary.unresolved += 1;
          console.error("[customer-voucher] reconcile void row failed", {
            operationId,
            crmRequestId: voidRow.crmRequestId,
            error: e,
          });
        }
      }
      if (voidRows.length > 0) all = await deps.ops.findByOperationId(operationId);
      for (const listed of opRows.filter((r) => !isPendingVoidRow(r))) {
        const row = all.find((r) => r.id === listed.id) ?? listed;
        if (!isReconcilableRow(row)) continue; // settled by its void just now
        if (all.some((r) => isPendingVoidRow(r) && r.crmRequestId === voidRequestIdFor(row.crmRequestId))) {
          summary.skipped += 1;
          continue;
        }
        summary.checked += 1;
        try {
          const result = await reconcileRow(row, deps);
          summary[result] += 1;
          // row.attempts counts settled-but-unsettling answers only (F-12).
          if (result === "unresolved" && row.attempts + 1 >= MAX_RECONCILE_ATTEMPTS) {
            await deps.ops.update(row.id, { status: "UNRESOLVED_MANUAL" });
            console.error("[customer-voucher] reconcile gave up — UNRESOLVED_MANUAL, needs a person", {
              operationId,
              crmRequestId: row.crmRequestId,
            });
          }
        } catch (e) {
          summary.unresolved += 1;
          console.error("[customer-voucher] reconcile row failed", {
            operationId,
            crmRequestId: row.crmRequestId,
            error: e,
          });
        }
      }
    } finally {
      releaseOperation(operationId);
    }
  }
  return summary;
}

// ── Scheduling ──────────────────────────────────────────────────────────────
let running = false;
let rerun = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function triggerCustomerVoucherReconcile(
  deps: ReconcileDeps = defaultReconcileDeps,
): Promise<void> | null {
  if (running) {
    rerun = true;
    return null;
  }
  running = true;
  return (async () => {
    try {
      do {
        rerun = false;
        try {
          const summary = await reconcileCustomerVoucherOperations(deps);
          if (summary.checked > 0 || summary.skipped > 0)
            console.info("[customer-voucher] reconcile", summary);
        } catch (e) {
          console.error("[customer-voucher] reconcile run failed", e);
        }
      } while (rerun);
    } finally {
      running = false;
    }
  })();
}

export function startCustomerVoucherReconciler() {
  void triggerCustomerVoucherReconcile();
  if (timer) return;
  timer = setInterval(() => {
    void triggerCustomerVoucherReconcile();
  }, RECONCILE_INTERVAL_MS);
  timer.unref?.();
}

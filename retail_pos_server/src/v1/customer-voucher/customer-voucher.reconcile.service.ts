import db from "../../libs/db";
import { claimOperation, releaseOperation } from "../sale/sale.operation";
import type { CrmOutcome, CrmOperationState } from "./customer-voucher.crm";
import {
  defaultCvDeps,
  REFUND_ISSUE_ENTITY_TYPE,
  voidRedeemRow,
  voidRefundIssueRow,
  type CvDeps,
} from "./customer-voucher.operation";
import type { CvOperationRow } from "./customer-voucher.operation.store";

// ══════════════════════════════════════════════════════════════════════════════
// Customer-voucher reconciler (T-15, platform/D-10 — R-4/V-2, V-12)
//
// Runs at boot and every 5 minutes over open primary ledger rows (INTENT,
// UNRESOLVED, CONFIRMED without invoice) untouched for 2+ minutes. For each it
// asks CRM for the effective state of its key (GET /device/customer-voucher/
// operation) — never trusting a redeem replay — and settles it:
//   REDEEM        not_found → FAILED (nothing happened)
//                 voided    → VOIDED
//                 redeemed  → local invoice with this operationId ? LINKED
//                             : void the redeem → VOIDED (UNRESOLVED if the void fails)
//   REFUND_ISSUE  not_found → FAILED; issue_voided → VOIDED
//                 issued    → local REFUND invoice ? LINKED : void → VOIDED
//   CRM unreachable → attempts+1, lastError, row stays as it is.
// Each operation is claimed (sale.operation.ts) while it is worked, so a till
// retrying the same operationId cannot race the reconciler.
//
// Scheduling: one run in flight; a trigger during a run sets a rerun flag and
// the run loops once more (not the R-5 drop-while-running pattern).
// ══════════════════════════════════════════════════════════════════════════════

export const RECONCILE_MIN_AGE_MS = 2 * 60 * 1000;
export const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

export interface ReconcileDeps extends CvDeps {
  findInvoiceByOperationId(
    operationId: string,
  ): Promise<{ id: number; type: string } | null>;
  now(): Date;
}

export const defaultReconcileDeps: ReconcileDeps = {
  ...defaultCvDeps,
  findInvoiceByOperationId: (operationId) =>
    db.saleInvoice.findUnique({
      where: { operationId },
      select: { id: true, type: true },
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
      attempted: true,
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
      if (invoice && invoice.type === "SALE") {
        await deps.ops.update(row.id, {
          status: "LINKED",
          invoiceId: invoice.id,
          crmEventId: eventId,
          attempted: true,
          lastError: null,
        });
        return "linked";
      }
      const result = await voidRedeemRow(
        row,
        "reconcile: CRM redeem without a local invoice",
        deps,
      );
      await deps.ops.update(row.id, { attempted: true });
      return result === "VOIDED" ? "voided" : "unresolved";
    }
  }

  if (row.kind === "REFUND_ISSUE") {
    if (state === "issue_voided") {
      await deps.ops.update(row.id, { status: "VOIDED", attempted: true, lastError: null });
      return "voided";
    }
    if (state === "issued") {
      if (invoice && invoice.type === "REFUND") {
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
      const result = await voidRefundIssueRow(
        row,
        "reconcile: CRM refund issue without a local refund invoice",
        deps,
      );
      await deps.ops.update(row.id, { attempted: true });
      return result === "VOIDED" ? "voided" : "unresolved";
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
  const rows = await deps.ops.listForReconcile(olderThan);

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
      for (const row of opRows) {
        summary.checked += 1;
        try {
          const result = await reconcileRow(row, deps);
          summary[result] += 1;
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

import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from "../../libs/exceptions";
import { operationCancelled, operationConflict } from "../sale/sale.operation";
import {
  crmCustomerVoucherClient,
  type CrmOutcome,
  type CustomerVoucherCrm,
} from "./customer-voucher.crm";
import {
  prismaCvOperationStore,
  type CustomerVoucherOperationStore,
  type CvOperationKind,
  type CvOperationRow,
  type CvOperationStatus,
} from "./customer-voucher.operation.store";
import type { CustomerVoucherWire } from "./customer-voucher.types";

// ══════════════════════════════════════════════════════════════════════════════
// Customer-voucher money effects with a durable intent/result ledger
// (T-15, platform/D-10 — R-4/V-2, V-3, V-12). Replaces the in-memory
// "redeemed[]" compensation list.
//
// Sale redeem, per customer-voucher tender (sequential):
//   INTENT row committed → CRM redeem (key <operationId>:cv:<voucherId>:<amount>)
//     ok, effective        → CONFIRMED (the sale tx later sets LINKED + invoiceId)
//     ok but voided (V-12) → VOIDED; the attempt is cancelled (409)
//     rejected             → FAILED; earlier CONFIRMED rows are voided; 400
//     unknown              → UNRESOLVED; nothing else is touched, 503. A retry
//                            with the same operationId replays the same keys;
//                            an abandoned attempt is voided by the reconciler.
// Refund issue: INTENT → CRM refund-issue (entityId <operationId>:cv-refund:<n>)
//   → CONFIRMED / FAILED / UNRESOLVED likewise; the refund tx sets LINKED.
// Voids (local failure, partial failure, reconciler): primary row → VOIDED on
// a CRM ok, else UNRESOLVED; each void also leaves a VOID_* audit row.
// ══════════════════════════════════════════════════════════════════════════════

export interface CvDeps {
  crm: CustomerVoucherCrm;
  ops: CustomerVoucherOperationStore;
}

export const defaultCvDeps: CvDeps = {
  crm: crmCustomerVoucherClient,
  ops: prismaCvOperationStore,
};

export const SALE_REDEEM_ENTITY_TYPE = "pos-sale-request";
export const REFUND_ISSUE_ENTITY_TYPE = "pos-refund-request";

export const CUSTOMER_VOUCHER_UNRESOLVED = "CUSTOMER_VOUCHER_UNRESOLVED";

export function redeemRequestIdFor(operationId: string, voucherId: number, amount: number) {
  return `${operationId}:cv:${voucherId}:${amount}`;
}

export function refundIssueEntityIdFor(operationId: string, tenderIndex: number) {
  return `${operationId}:cv-refund:${tenderIndex}`;
}

export function voidRequestIdFor(crmRequestId: string) {
  return `${crmRequestId}:void`;
}

interface PaymentLike {
  type: string;
  amount: number;
  entityType?: string;
  entityId?: number;
  entityLabel?: string;
}

function isCustomerVoucher(p: PaymentLike) {
  return p.type === "VOUCHER" && p.entityType === "customer-voucher";
}

function rejectionError(outcome: { status: number; msg: string }): HttpException {
  if (outcome.status === 401 || outcome.status === 403)
    return new UnauthorizedException(outcome.msg);
  return new BadRequestException(outcome.msg);
}

export function unresolvedError(what: string): HttpException {
  return new HttpException(
    503,
    `Customer voucher service did not answer (${what}). Press the button again to retry; if you cancel instead, the voucher is given back automatically within a few minutes.`,
    { code: CUSTOMER_VOUCHER_UNRESOLVED },
  );
}

// F-3 (T-15 review): a key whose earlier call may have reached CRM (row left
// INTENT / UNRESOLVED / CONFIRMED by a previous request) is ambiguous. A CRM
// rejection of a *retry* proves nothing about that earlier call, so such a row
// never becomes FAILED here — it stays UNRESOLVED until the reconciler's
// operation lookup says not_found / voided / redeemed. Only a definitive
// rejection of a key with no ambiguous history marks FAILED.
const AMBIGUOUS_STATUSES: CvOperationStatus[] = ["INTENT", "UNRESOLVED", "CONFIRMED"];

function ambiguousKeysOf(prior: CvOperationRow[]): Set<string> {
  return new Set(
    prior
      .filter((row) => AMBIGUOUS_STATUSES.includes(row.status))
      .map((row) => row.crmRequestId),
  );
}

function errorText(outcome: CrmOutcome<unknown>): string | null {
  if (outcome.kind === "ok") return null;
  return `${outcome.kind} ${outcome.status}: ${outcome.msg}`.slice(0, 500);
}

// ── Sale redeem ─────────────────────────────────────────────────────────────

export async function redeemCustomerVouchersForOperation(
  args: { operationId: string; memberId: string; payments: PaymentLike[] },
  deps: CvDeps = defaultCvDeps,
): Promise<CvOperationRow[]> {
  const { operationId, memberId } = args;
  const cvPayments = args.payments.filter(isCustomerVoucher);

  const seen = new Set<number>();
  for (const payment of cvPayments) {
    if (payment.entityId == null)
      throw new BadRequestException("customer voucher entityId missing");
    if (seen.has(payment.entityId))
      throw new BadRequestException(
        `customer voucher ${payment.entityId} used more than once`,
      );
    seen.add(payment.entityId);
  }

  const intents = cvPayments.map((p) => ({
    voucherId: p.entityId!,
    amount: p.amount,
    note: p.entityLabel ?? null,
    crmRequestId: redeemRequestIdFor(operationId, p.entityId!, p.amount),
  }));

  // A retry of this operation must carry the same voucher tenders.
  const prior = (await deps.ops.findByOperationId(operationId)).filter(
    (row) => row.kind === "REDEEM",
  );
  const keys = new Set(intents.map((i) => i.crmRequestId));
  for (const row of prior) {
    if (!keys.has(row.crmRequestId)) {
      if (row.status === "FAILED") continue; // nothing happened under it
      throw operationConflict(
        "This operationId was already used with other customer voucher tenders (409). Start a new attempt.",
      );
    }
    if (row.memberId && row.memberId !== memberId)
      throw operationConflict(
        "This operationId was already used for another member (409). Start a new attempt.",
      );
    if (row.status === "VOIDED") throw operationCancelled();
    if (row.status === "LINKED")
      throw operationConflict(
        "This operationId already belongs to a recorded invoice (409).",
      );
  }

  const ambiguous = ambiguousKeysOf(prior);

  // INTENT rows are committed before any CRM call.
  const rows: CvOperationRow[] = [];
  for (const intent of intents) {
    rows.push(
      await deps.ops.ensureIntent({
        operationId,
        kind: "REDEEM",
        voucherId: intent.voucherId,
        memberId,
        amount: intent.amount,
        crmRequestId: intent.crmRequestId,
      }),
    );
  }

  const confirmed: CvOperationRow[] = [];
  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i];
    const row = rows[i];
    const outcome = await deps.crm.redeem({
      memberId,
      voucherId: intent.voucherId,
      amount: intent.amount,
      requestId: intent.crmRequestId,
      entityType: SALE_REDEEM_ENTITY_TYPE,
      entityId: operationId,
      entitySerial: null,
      note: intent.note,
    });

    if (outcome.kind === "ok" && !outcome.result.voided) {
      confirmed.push(
        await deps.ops.update(row.id, {
          status: "CONFIRMED",
          crmEventId: outcome.result.eventId,
          crmVoucherId: outcome.result.voucherId,
          lastError: null,
          attempted: true,
        }),
      );
      continue;
    }

    if (outcome.kind === "ok") {
      // V-12: CRM replays a redeem that was voided — terminal for this key.
      await deps.ops.update(row.id, {
        status: "VOIDED",
        crmEventId: outcome.result.eventId,
        lastError: "CRM reports this redeem was voided",
        attempted: true,
      });
      await voidRedeemRows(confirmed, "POS sale attempt cancelled (voided redeem replayed)", deps);
      throw operationCancelled();
    }

    if (outcome.kind === "rejected") {
      const wasAmbiguous = ambiguous.has(intent.crmRequestId);
      await deps.ops.update(row.id, {
        status: wasAmbiguous ? "UNRESOLVED" : "FAILED",
        lastError: wasAmbiguous
          ? `retry ${errorText(outcome)} (earlier call unresolved)`
          : errorText(outcome),
        attempted: true,
      });
      await voidRedeemRows(
        confirmed,
        "POS customer voucher sale redeem failed after partial success",
        deps,
      );
      if (wasAmbiguous) throw unresolvedError("voucher redeem");
      throw rejectionError(outcome);
    }

    await deps.ops.update(row.id, {
      status: "UNRESOLVED",
      lastError: errorText(outcome),
      attempted: true,
    });
    throw unresolvedError("voucher redeem");
  }
  return confirmed;
}

async function recordVoidAudit(
  parent: CvOperationRow,
  kind: CvOperationKind,
  requestId: string,
  outcome: CrmOutcome<{ eventId: number | null }>,
  deps: CvDeps,
) {
  try {
    const audit = await deps.ops.ensureIntent({
      operationId: parent.operationId,
      kind,
      voucherId: parent.voucherId,
      memberId: parent.memberId,
      amount: parent.amount,
      crmRequestId: requestId,
    });
    const status: CvOperationStatus =
      outcome.kind === "ok" ? "CONFIRMED" : outcome.kind === "rejected" ? "FAILED" : "UNRESOLVED";
    await deps.ops.update(audit.id, {
      status,
      crmEventId: outcome.kind === "ok" ? outcome.result.eventId : null,
      lastError: errorText(outcome),
      attempted: true,
    });
  } catch (e) {
    console.error("[customer-voucher] void audit row write failed", {
      operationId: parent.operationId,
      requestId,
      error: e,
    });
  }
}

// Voids one REDEEM row. Never throws: a failed void leaves the row
// UNRESOLVED for the reconciler.
export async function voidRedeemRow(
  row: CvOperationRow,
  reason: string,
  deps: CvDeps = defaultCvDeps,
): Promise<"VOIDED" | "UNRESOLVED"> {
  const requestId = voidRequestIdFor(row.crmRequestId);
  let outcome: CrmOutcome<{ eventId: number | null }>;
  try {
    outcome = await deps.crm.voidRedeem({
      redeemRequestId: row.crmRequestId,
      requestId,
      note: reason,
    });
  } catch (e) {
    outcome = { kind: "unknown", status: 0, msg: String(e) };
  }
  await recordVoidAudit(row, "VOID_REDEEM", requestId, outcome, deps);
  const status = outcome.kind === "ok" ? "VOIDED" : "UNRESOLVED";
  try {
    await deps.ops.update(row.id, {
      status,
      lastError: outcome.kind === "ok" ? null : `void ${errorText(outcome)}`,
    });
  } catch (e) {
    console.error("[customer-voucher] ledger update after void failed", {
      operationId: row.operationId,
      crmRequestId: row.crmRequestId,
      error: e,
    });
  }
  if (status === "UNRESOLVED")
    console.error("[customer-voucher] redeem void failed — left UNRESOLVED for the reconciler", {
      operationId: row.operationId,
      crmRequestId: row.crmRequestId,
      outcome,
    });
  return status;
}

export async function voidRedeemRows(rows: CvOperationRow[], reason: string, deps: CvDeps) {
  for (const row of rows) await voidRedeemRow(row, reason, deps);
}

// ── Refund issue ────────────────────────────────────────────────────────────

export interface IssuedRefundVoucher {
  row: CvOperationRow;
  voucher: CustomerVoucherWire;
}

export async function issueRefundVoucherForOperation(
  args: {
    operationId: string;
    tenderIndex: number;
    memberId: string;
    amount: number;
    entitySerial: string | null;
  },
  deps: CvDeps = defaultCvDeps,
): Promise<IssuedRefundVoucher> {
  const entityId = refundIssueEntityIdFor(args.operationId, args.tenderIndex);

  const prior = (await deps.ops.findByOperationId(args.operationId)).filter(
    (row) => row.kind === "REFUND_ISSUE",
  );
  for (const row of prior) {
    if (row.crmRequestId !== entityId) {
      if (row.status === "FAILED") continue;
      throw operationConflict(
        "This operationId was already used with another customer voucher refund tender (409). Start a new attempt.",
      );
    }
    if (row.amount !== args.amount || (row.memberId && row.memberId !== args.memberId))
      throw operationConflict(
        "This operationId was already used for a different refund (409). Start a new attempt.",
      );
    if (row.status === "VOIDED") throw operationCancelled();
    if (row.status === "LINKED")
      throw operationConflict("This operationId already belongs to a recorded refund (409).");
  }

  const wasAmbiguous = ambiguousKeysOf(prior).has(entityId);

  const row = await deps.ops.ensureIntent({
    operationId: args.operationId,
    kind: "REFUND_ISSUE",
    voucherId: null,
    memberId: args.memberId,
    amount: args.amount,
    crmRequestId: entityId,
  });

  const outcome = await deps.crm.issueRefund({
    memberId: args.memberId,
    amount: args.amount,
    entityType: REFUND_ISSUE_ENTITY_TYPE,
    entityId,
    entitySerial: args.entitySerial,
    note: "Customer voucher refund",
  });

  if (outcome.kind === "ok" && !outcome.result.voided && outcome.result.voucher) {
    const updated = await deps.ops.update(row.id, {
      status: "CONFIRMED",
      voucherId: outcome.result.voucher.id,
      crmVoucherId: outcome.result.voucher.id,
      crmEventId: outcome.result.eventId,
      lastError: null,
      attempted: true,
    });
    return { row: updated, voucher: outcome.result.voucher };
  }
  if (outcome.kind === "ok") {
    await deps.ops.update(row.id, {
      status: "VOIDED",
      crmEventId: outcome.result.eventId,
      lastError: "CRM reports this refund issue was voided",
      attempted: true,
    });
    throw operationCancelled();
  }
  if (outcome.kind === "rejected") {
    await deps.ops.update(row.id, {
      status: wasAmbiguous ? "UNRESOLVED" : "FAILED",
      lastError: wasAmbiguous
        ? `retry ${errorText(outcome)} (earlier call unresolved)`
        : errorText(outcome),
      attempted: true,
    });
    if (wasAmbiguous) throw unresolvedError("refund voucher issue");
    throw rejectionError(outcome);
  }
  await deps.ops.update(row.id, {
    status: "UNRESOLVED",
    lastError: errorText(outcome),
    attempted: true,
  });
  throw unresolvedError("refund voucher issue");
}

// Voids one REFUND_ISSUE row through CRM's refund-issue/void. Never throws.
export async function voidRefundIssueRow(
  row: CvOperationRow,
  reason: string,
  deps: CvDeps = defaultCvDeps,
): Promise<"VOIDED" | "UNRESOLVED"> {
  const requestId = voidRequestIdFor(row.crmRequestId);
  let outcome: CrmOutcome<{ eventId: number | null }>;
  try {
    outcome = await deps.crm.voidRefundIssue({
      entityType: REFUND_ISSUE_ENTITY_TYPE,
      entityId: row.crmRequestId,
      requestId,
      note: reason,
    });
  } catch (e) {
    outcome = { kind: "unknown", status: 0, msg: String(e) };
  }
  await recordVoidAudit(row, "VOID_REFUND_ISSUE", requestId, outcome, deps);
  const status = outcome.kind === "ok" ? "VOIDED" : "UNRESOLVED";
  try {
    await deps.ops.update(row.id, {
      status,
      lastError: outcome.kind === "ok" ? null : `void ${errorText(outcome)}`,
    });
  } catch (e) {
    console.error("[customer-voucher] ledger update after refund void failed", {
      operationId: row.operationId,
      crmRequestId: row.crmRequestId,
      error: e,
    });
  }
  if (status === "UNRESOLVED")
    console.error("[customer-voucher] refund issue void failed — left UNRESOLVED", {
      operationId: row.operationId,
      crmRequestId: row.crmRequestId,
      outcome,
    });
  return status;
}

// ── V-6: whole-Invoice CRM reachability ─────────────────────────────────────
// Rule retail-pos/customer-voucher-requires-crm-online (owner #31, 2026-10-08):
// a refund of an original Invoice that contains a customer-voucher tender is
// refused while CRM is unreachable — even when the requested tenders are
// cash/credit only. No partial, no cash fallback, no queue.
export async function assertCrmReachableForOriginal(
  orig: { memberId: string | null; payments: Array<{ entityType: string | null }> },
  deps: CvDeps = defaultCvDeps,
) {
  const hasCustomerVoucher = orig.payments.some(
    (p) => p.entityType === "customer-voucher",
  );
  if (!hasCustomerVoucher) return;
  let outcome: CrmOutcome<true>;
  try {
    outcome = await deps.crm.ping(orig.memberId ?? "");
  } catch (e) {
    outcome = { kind: "unknown", status: 0, msg: String(e) };
  }
  if (outcome.kind !== "ok")
    throw new HttpException(
      503,
      "CRM is unreachable. This invoice was paid with a Customer Voucher, so no part of it can be refunded until CRM is back (no partial or cash fallback).",
      { code: "CUSTOMER_VOUCHER_CRM_OFFLINE" },
    );
}

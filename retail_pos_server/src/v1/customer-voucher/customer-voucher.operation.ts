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
  isPendingVoidRow,
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
export const CUSTOMER_VOUCHER_EFFECT_PENDING = "CUSTOMER_VOUCHER_EFFECT_PENDING";

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
const AMBIGUOUS_STATUSES: CvOperationStatus[] = [
  "INTENT",
  "UNRESOLVED",
  "CONFIRMED",
  "UNRESOLVED_MANUAL",
];

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

// ── F-6: pending effects bind the operation ─────────────────────────────────
// A CRM effect already asked for under this operationId (row INTENT /
// CONFIRMED / UNRESOLVED) must be carried by the payload being retried: same
// key and same amount. Otherwise nothing is committed — e.g. a lost redeem
// answer followed by "swap the voucher for cash" would charge twice. Answer
// 409 CUSTOMER_VOUCHER_EFFECT_PENDING naming the effect; the till keeps the
// id (put the same voucher tender back) or the cashier clears the cart, after
// which the reconciler voids the effect (no matching Invoice). Runs for every
// sale/refund request, with or without a customer-voucher tender.
const PENDING_STATUSES: CvOperationStatus[] = [
  "INTENT",
  "CONFIRMED",
  "UNRESOLVED",
  "UNRESOLVED_MANUAL",
];

export function saleRedeemExpectations(
  operationId: string,
  payments: PaymentLike[],
): Map<string, number> {
  const expected = new Map<string, number>();
  for (const p of payments) {
    if (!isCustomerVoucher(p) || p.entityId == null) continue;
    expected.set(redeemRequestIdFor(operationId, p.entityId, p.amount), p.amount);
  }
  return expected;
}

export function refundIssueExpectations(
  operationId: string,
  payments: PaymentLike[],
): Map<string, number> {
  const expected = new Map<string, number>();
  payments.forEach((p, index) => {
    if (isCustomerVoucher(p))
      expected.set(refundIssueEntityIdFor(operationId, index), p.amount);
  });
  return expected;
}

export async function assertNoPendingVoucherEffects(
  operationId: string,
  kind: "REDEEM" | "REFUND_ISSUE",
  expected: Map<string, number>,
  deps: CvDeps,
) {
  const all = await deps.ops.findByOperationId(operationId);
  // F-11 — a reversal not yet confirmed: this operation can never become
  // payment again, whatever the payload.
  const pendingVoids = all.filter(isPendingVoidRow);
  if (pendingVoids.length > 0)
    throw new HttpException(
      409,
      "A customer voucher reversal for this checkout is still being confirmed with CRM. Clear the cart and ring the sale again; the voucher is given back automatically.",
      {
        code: CUSTOMER_VOUCHER_EFFECT_PENDING,
        effects: pendingVoids.map((row) => ({
          kind: row.kind,
          voucherId: row.voucherId,
          amount: row.amount,
          status: row.status,
        })),
      },
    );
  const pending = all.filter(
    (row) =>
      row.kind === kind &&
      PENDING_STATUSES.includes(row.status) &&
      expected.get(row.crmRequestId) !== row.amount,
  );
  if (pending.length === 0) return;
  const what = pending
    .map((row) =>
      kind === "REDEEM"
        ? `$${(row.amount / 100).toFixed(2)} on customer voucher #${row.voucherId}`
        : `a $${(row.amount / 100).toFixed(2)} refund voucher`,
    )
    .join(", ");
  throw new HttpException(
    409,
    `This checkout already asked CRM for ${what}, and that is not settled yet. Put the same customer voucher payment back and press again, or clear the cart — the voucher is then given back automatically within a few minutes.`,
    {
      code: CUSTOMER_VOUCHER_EFFECT_PENDING,
      effects: pending.map((row) => ({
        kind: row.kind,
        voucherId: row.voucherId,
        amount: row.amount,
        status: row.status,
      })),
    },
  );
}

// ── F-8: what did a failed local transaction leave? ─────────────────────────
// A persistence error does not prove nothing committed (the COMMIT ack can be
// lost). Before compensating, ask the DB for the invoice under the id:
//   committed → it exists (its ledger rows were LINKED in the same tx)
//   absent    → nothing committed; the caller voids its CRM effects
//   unknown   → the lookup failed too; leave the effects UNRESOLVED for the
//               reconciler, which links or voids by the invoice's tenders.
export type PersistOutcome<T> =
  | { state: "committed"; invoice: T }
  | { state: "absent" }
  | { state: "unknown" };

export async function lookupAfterPersistError<T>(
  find: () => Promise<T | null>,
): Promise<PersistOutcome<T>> {
  try {
    const invoice = await find();
    return invoice ? { state: "committed", invoice } : { state: "absent" };
  } catch (e) {
    console.error("[customer-voucher] invoice lookup after a persistence error failed", e);
    return { state: "unknown" };
  }
}

export async function markRowsUnresolved(rows: CvOperationRow[], reason: string, deps: CvDeps) {
  for (const row of rows) {
    try {
      await deps.ops.update(row.id, { status: "UNRESOLVED", lastError: reason });
    } catch (e) {
      // DB unreachable: the row stays CONFIRMED without invoice — still swept.
      console.error("[customer-voucher] could not mark row UNRESOLVED", {
        operationId: row.operationId,
        crmRequestId: row.crmRequestId,
        error: e,
      });
    }
  }
}

// ── Sale redeem ─────────────────────────────────────────────────────────────

// A CONFIRMED redeem plus CRM's label for the voucher (not persisted on the
// ledger row; a retry re-asks CRM, whose replay answers the same event).
export type ConfirmedRedeemRow = CvOperationRow & { crmVoucherLabel: string | null };

export async function redeemCustomerVouchersForOperation(
  args: { operationId: string; memberId: string; payments: PaymentLike[] },
  deps: CvDeps = defaultCvDeps,
): Promise<ConfirmedRedeemRow[]> {
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
  await assertNoPendingVoucherEffects(
    operationId,
    "REDEEM",
    saleRedeemExpectations(operationId, args.payments),
    deps,
  );
  for (const row of prior) {
    // Other keys: pending ones were refused just above; FAILED / VOIDED ones
    // left nothing at CRM.
    if (!keys.has(row.crmRequestId)) continue;
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

  const confirmed: ConfirmedRedeemRow[] = [];
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
      const updated = await deps.ops.update(row.id, {
        status: "CONFIRMED",
        crmEventId: outcome.result.eventId,
        crmVoucherId: outcome.result.voucherId,
        lastError: null,
        attempted: true,
      });
      confirmed.push({ ...updated, crmVoucherLabel: outcome.result.voucherLabel });
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
      transient: true,
    });
    throw unresolvedError("voucher redeem");
  }
  return confirmed;
}

// ── V-7 / O-17 (T-25): payments carry the validated CRM result ────────────
// Each customer-voucher tender is persisted with the CRM event id of its
// REDEEM and CRM's label for the voucher — never the till's label or any
// client-sent id. Other tenders carry no crmEventId.
export function customerVoucherFallbackLabel(voucherId: number | null | undefined) {
  return voucherId != null ? `Customer Voucher #${voucherId}` : "Customer Voucher";
}

export function applyCrmRedeemResults<P extends PaymentLike>(
  operationId: string,
  payments: P[],
  confirmed: ConfirmedRedeemRow[],
): Array<P & { crmEventId: number | null }> {
  const byKey = new Map(confirmed.map((row) => [row.crmRequestId, row]));
  return payments.map((p) => {
    if (!isCustomerVoucher(p) || p.entityId == null) return { ...p, crmEventId: null };
    const row = byKey.get(redeemRequestIdFor(operationId, p.entityId, p.amount));
    if (!row)
      throw new HttpException(
        500,
        "customer voucher payment has no confirmed CRM redeem",
      );
    return {
      ...p,
      crmEventId: row.crmEventId,
      entityLabel: row.crmVoucherLabel ?? customerVoucherFallbackLabel(p.entityId),
    };
  });
}

// F-11 — a compensation is recorded BEFORE it is sent: the VOID_* row is
// committed as INTENT, then the CRM void, then
//   ok        → void row CONFIRMED, primary VOIDED            → "VOIDED"
//   rejected  → void row FAILED (CRM refused; nothing reversed) — or
//               UNRESOLVED when an earlier send of it was ambiguous (F-13),
//               primary UNRESOLVED                            → "REJECTED"
//   unknown   → void row UNRESOLVED, primary UNRESOLVED       → "UNKNOWN"
// While the void row is INTENT/UNRESOLVED the primary can never become
// payment again (assertNoPendingVoucherEffects); the reconciler settles the
// void first. If the intent cannot be written, no void is sent ("UNKNOWN").
// Never throws.
export type VoidResult = "VOIDED" | "REJECTED" | "UNKNOWN";

async function sendVoid(
  primary: CvOperationRow,
  kind: "VOID_REDEEM" | "VOID_REFUND_ISSUE",
  send: (requestId: string) => Promise<CrmOutcome<{ eventId: number | null }>>,
  deps: CvDeps,
): Promise<VoidResult> {
  const requestId = voidRequestIdFor(primary.crmRequestId);
  const log = { operationId: primary.operationId, crmRequestId: primary.crmRequestId };
  let voidRow: CvOperationRow;
  // F-13 — same rule as F-3: a void sent before whose outcome is unknown
  // (row left INTENT / UNRESOLVED / UNRESOLVED_MANUAL) is ambiguous; a
  // rejection of the re-send proves nothing about the earlier one, so the
  // row stays UNRESOLVED (still blocking checkout) until the reconciler's
  // operation lookup settles it. FAILED only when the first send is refused.
  let wasAmbiguous = false;
  try {
    const existing = await deps.ops.findByCrmRequestId(requestId);
    wasAmbiguous = existing != null && AMBIGUOUS_STATUSES.includes(existing.status) && existing.status !== "CONFIRMED";
    voidRow = await deps.ops.ensureIntent({
      operationId: primary.operationId,
      kind,
      voucherId: primary.voucherId,
      memberId: primary.memberId,
      amount: primary.amount,
      crmRequestId: requestId,
    });
  } catch (e) {
    console.error("[customer-voucher] void intent write failed — void NOT sent", { ...log, error: e });
    await markRowsUnresolved([primary], "void intent could not be recorded", deps);
    return "UNKNOWN";
  }

  let outcome: CrmOutcome<{ eventId: number | null }>;
  if (voidRow.status === "CONFIRMED") {
    outcome = { kind: "ok", result: { eventId: voidRow.crmEventId } }; // already done
  } else {
    try {
      outcome = await send(requestId);
    } catch (e) {
      outcome = { kind: "unknown", status: 0, msg: String(e) };
    }
  }

  const result: VoidResult =
    outcome.kind === "ok" ? "VOIDED" : outcome.kind === "rejected" ? "REJECTED" : "UNKNOWN";
  try {
    await deps.ops.update(voidRow.id, {
      status:
        result === "VOIDED"
          ? "CONFIRMED"
          : result === "REJECTED" && !wasAmbiguous
            ? "FAILED"
            : "UNRESOLVED",
      crmEventId: outcome.kind === "ok" ? outcome.result.eventId : voidRow.crmEventId,
      lastError: errorText(outcome),
      ...(result === "UNKNOWN" ? { transient: true } : { attempted: true }),
    });
    await deps.ops.update(primary.id, {
      status: result === "VOIDED" ? "VOIDED" : "UNRESOLVED",
      lastError: result === "VOIDED" ? null : `void ${errorText(outcome)}`,
    });
  } catch (e) {
    // The void row stays INTENT (or as it was): still pending, still swept.
    console.error("[customer-voucher] ledger update after void failed", { ...log, error: e });
  }
  if (result !== "VOIDED")
    console.error("[customer-voucher] void not confirmed — left for the reconciler", { ...log, outcome });
  return result;
}

// Voids one REDEEM row. Never throws.
export function voidRedeemRow(
  row: CvOperationRow,
  reason: string,
  deps: CvDeps = defaultCvDeps,
): Promise<VoidResult> {
  return sendVoid(
    row,
    "VOID_REDEEM",
    (requestId) =>
      deps.crm.voidRedeem({ redeemRequestId: row.crmRequestId, requestId, note: reason }),
    deps,
  );
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
    // Pending effects under other keys / amounts are refused by
    // assertNoPendingVoucherEffects in createRefundService.
    if (row.crmRequestId !== entityId) continue;
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
    transient: true,
  });
  throw unresolvedError("refund voucher issue");
}

// Voids one REFUND_ISSUE row through CRM's refund-issue/void. Never throws.
export function voidRefundIssueRow(
  row: CvOperationRow,
  reason: string,
  deps: CvDeps = defaultCvDeps,
): Promise<VoidResult> {
  return sendVoid(
    row,
    "VOID_REFUND_ISSUE",
    (requestId) =>
      deps.crm.voidRefundIssue({
        entityType: REFUND_ISSUE_ENTITY_TYPE,
        entityId: row.crmRequestId,
        requestId,
        note: reason,
      }),
    deps,
  );
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

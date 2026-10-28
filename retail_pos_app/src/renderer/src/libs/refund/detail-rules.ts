// Refund detail rules — the state rules of the till's Refund detail screen
// (screens/SaleRefundDetailScreen), hoisted out of the React component
// (retail-runner T-16, S-4 §3 / A9) so the runner's Refund uses the same
// rules. Pure: no React, DOM, Electron or HTTP client. Runner copies this
// file verbatim.
//
// Units: money in cents, qty ×1000 (libs/constants.ts). The server recomputes
// every amount (rule retail-pos/refund-last-takes-remainder); these rules only
// shape the cashier's intent the way the till always has.

import type { SaleInvoiceRowItem } from "../sale/invoice.types";
import { rowRefundable, type RefundSelection, type TenderCapEntry } from "./compute";
import type { TenderAmountMap } from "./build-payload";

// ── Cash-only mode ───────────────────────────────────────────────
// Every non-cash tender input is 0 and the cash input is > 0. Feeds
// computeInvoice(…, { allCashMode }) — the cash-only round-5 rule (D-30).
export function isAllCashMode(
  caps: TenderCapEntry[],
  tenderAmounts: TenderAmountMap,
): boolean {
  let cashSum = 0;
  let nonCashSum = 0;
  for (const c of caps) {
    const amt = tenderAmounts[c.keyStr] ?? 0;
    if (c.key.kind === "CASH") cashSum += amt;
    else nonCashSum += amt;
  }
  return cashSum > 0 && nonCashSum === 0;
}

// ── Paid / remaining / complete ─────────────────────────────────
export function refundPaid(tenderAmounts: TenderAmountMap): number {
  return Object.values(tenderAmounts).reduce((s, n) => s + n, 0);
}

export function refundRemaining(total: number, paid: number): number {
  return total - paid;
}

export function anyRefundRowSelected(selections: RefundSelection): boolean {
  return Object.values(selections).some((q) => q > 0);
}

// COMPLETE REFUND: at least one row, a positive total, nothing left to allocate.
export function canCompleteRefund(
  selections: RefundSelection,
  total: number,
  remaining: number,
): boolean {
  return anyRefundRowSelected(selections) && total > 0 && remaining === 0;
}

// ── Row selection ────────────────────────────────────────────────
// Row qty is clamped to 0 … rowRefundable(row) (weighed rows: whole or none,
// see compute.ts rowRefundable / rowQtyTap).
export function clampRowQty(row: SaleInvoiceRowItem, qty: number): number {
  const cap = rowRefundable(row);
  return Math.max(0, Math.min(cap, qty));
}

export function withRowQty(
  selections: RefundSelection,
  row: SaleInvoiceRowItem,
  qty: number,
): RefundSelection {
  return { ...selections, [row.id]: clampRowQty(row, qty) };
}

// Row "All" — the row's whole refundable qty.
export function withRowRefundAll(
  selections: RefundSelection,
  row: SaleInvoiceRowItem,
): RefundSelection {
  return withRowQty(selections, row, rowRefundable(row));
}

// "Refund All Rows" — every row at its refundable qty (replaces the selection).
export function refundAllRowsSelection(
  rows: SaleInvoiceRowItem[],
): RefundSelection {
  const next: RefundSelection = {};
  for (const r of rows) next[r.id] = rowRefundable(r);
  return next;
}

// "Clear" — rows and tender inputs both emptied. Never ends the refund
// attempt (libs/operation-id.ts): only a server answer does.
export function clearedRefundInputs(): {
  selections: RefundSelection;
  tenderAmounts: TenderAmountMap;
} {
  return { selections: {}, tenderAmounts: {} };
}

// ── Tender amounts ───────────────────────────────────────────────
// Set on the money numpad: clamp to 0 … the tender's remaining cap. No cap
// for the key → null (the input is ignored).
export function clampTenderAmount(
  caps: TenderCapEntry[],
  keyStr: string,
  cents: number,
): number | null {
  const cap = caps.find((c) => c.keyStr === keyStr);
  if (!cap) return null;
  return Math.max(0, Math.min(cap.remaining, cents));
}

// Fill — this tender takes what is left of the refund. When it is CASH and no
// other non-cash tender has an amount, the refund becomes cash-only and the
// target is the round-5 total (same principle as the PaymentModal CashInput
// EXACT — D-30); any other tender fills the exact amount. Clamped to the
// tender's remaining cap. No cap for the key → null (nothing changes).
export function fillTenderAmount(
  caps: TenderCapEntry[],
  tenderAmounts: TenderAmountMap,
  keyStr: string,
  subtotalBeforeRounding: number,
): number | null {
  const cap = caps.find((c) => c.keyStr === keyStr);
  if (!cap) return null;

  let otherCash = 0;
  let otherNonCash = 0;
  for (const c of caps) {
    if (c.keyStr === keyStr) continue;
    const a = tenderAmounts[c.keyStr] ?? 0;
    if (c.key.kind === "CASH") otherCash += a;
    else otherNonCash += a;
  }
  const thisIsCash = cap.key.kind === "CASH";
  const willBeCashOnly = thisIsCash && otherNonCash === 0;
  const hypothetical = willBeCashOnly
    ? Math.round(subtotalBeforeRounding / 5) * 5
    : subtotalBeforeRounding;
  const left = hypothetical - otherCash - otherNonCash;
  return Math.max(0, Math.min(cap.remaining, left));
}

// ── After a successful refund ───────────────────────────────────
// The cash drawer opens (before the receipt prints) when the refund sent any
// CASH amount.
export function refundCashAmount(
  payments: { type: string; amount: number }[],
): number {
  return payments
    .filter((p) => p.type === "CASH")
    .reduce((s, p) => s + p.amount, 0);
}

export function refundOpensDrawer(
  payments: { type: string; amount: number }[],
): boolean {
  return refundCashAmount(payments) > 0;
}

// ── Texts (the till's, verbatim) ────────────────────────────────
export const REFUND_TEXTS = {
  completeButton: "COMPLETE REFUND",
  processing: "Processing...",
  reviewTitle: "Review Refund",
  reviewCancel: "Cancel",
  reviewNext: "Looks Good →",
  confirmTitle: "⚠ Confirm Refund",
  // "<total> will be refunded from invoice <serial>."
  confirmWillBeRefunded: " will be refunded from invoice ",
  confirmWarning:
    "This creates a REFUND invoice and cannot be undone from the POS. EFTPOS / gift card entries must be keyed in manually on the terminal.",
  confirmBack: "← Back",
  confirmSubmit: "REFUND NOW",
  failed: "Refund failed",
  failedUnexpected: "Refund failed — see console",
} as const;

// The confirm sentence as plain text (hosts that render it in one string).
export function refundConfirmSentence(totalText: string, serial: string): string {
  return `${totalText}${REFUND_TEXTS.confirmWillBeRefunded}${serial}.`;
}

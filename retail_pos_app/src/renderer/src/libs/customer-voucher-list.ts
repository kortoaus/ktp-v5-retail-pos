// T-25 (platform; T-14 V-10) — the till's customer-voucher list and member
// badges, as pure rules (tested in customer-voucher-list.test.mjs).
//
//  - The list has four distinct states. A failed list read is "unavailable"
//    (CRM unavailable — Retry), never "No vouchers": the cashier must be able
//    to tell "CRM down" from "this member owns nothing".
//  - "Voucher available" means the member OWNS spendable voucher balance
//    (ACTIVE, not expired, balance > 0). Points → voucher exchange readiness
//    (points ≥ CUSTOMER_VOUCHER_ISSUE_POINTS) is a separate indicator.

import type { CustomerVoucher } from "../service/customer-voucher.service";

export type VoucherListAnswer = {
  ok: boolean;
  msg?: string;
  result?: CustomerVoucher[] | null;
};

export type VoucherListState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; rows: CustomerVoucher[] };

export const VOUCHER_LIST_UNAVAILABLE = "CRM unavailable";

export function isEligibleVoucher(voucher: CustomerVoucher, now: Date): boolean {
  return (
    voucher.status === "ACTIVE" &&
    voucher.balance > 0 &&
    new Date(voucher.validTo).getTime() >= now.getTime()
  );
}

export function voucherListStateFromAnswer(
  answer: VoucherListAnswer | null,
  now: Date,
): VoucherListState {
  if (!answer || !answer.ok || !Array.isArray(answer.result))
    return { kind: "unavailable", message: VOUCHER_LIST_UNAVAILABLE };
  const rows = answer.result.filter((v) => isEligibleVoucher(v, now));
  return rows.length === 0 ? { kind: "empty" } : { kind: "ready", rows };
}

// Σ balance of the member's eligible vouchers; null while unknown (loading or
// CRM unavailable).
export function ownedEligibleBalance(state: VoucherListState): number | null {
  if (state.kind === "empty") return 0;
  if (state.kind === "ready") return state.rows.reduce((sum, v) => sum + v.balance, 0);
  return null;
}

export type VoucherBadge = "available" | "none" | "unknown";

export interface MemberVoucherIndicators {
  // owned eligible voucher balance → "Voucher available"
  voucherBadge: VoucherBadge;
  ownedBalance: number | null;
  // separate: points are enough for a points → voucher exchange
  exchangeReady: boolean;
}

export function memberVoucherIndicators(input: {
  state: VoucherListState;
  points: number | null;
  issuePoints: number;
}): MemberVoucherIndicators {
  const ownedBalance = ownedEligibleBalance(input.state);
  return {
    voucherBadge: ownedBalance == null ? "unknown" : ownedBalance > 0 ? "available" : "none",
    ownedBalance,
    exchangeReady: input.points != null && input.points >= input.issuePoints,
  };
}

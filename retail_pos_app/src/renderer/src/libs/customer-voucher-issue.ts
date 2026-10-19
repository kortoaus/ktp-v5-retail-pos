// T-17 / F-16 — what the till does with an answer to the points→voucher
// exchange press. A fresh issue is selected for payment straight away (as
// before). A replay (`replayed: true`: an earlier press already issued this
// voucher, its answer was lost) is NOT auto-selected — the recovered voucher
// may since be spent, expired or already in this sale. The modal refreshes the
// member's valid vouchers, shows one notice line and the cashier picks an
// eligible voucher from the list. The attempt is settled by the service
// (sendWithOperation) either way.
// F-17: both ok branches carry the member's points after the exchange; the
// modal reports them to the payment screen on ANY ok answer, independently of
// voucher selection, and re-fetches the member when a replay sends null.
// retail-delivery D-24: the four exchange tiers, what a member can afford and
// the two confirmation texts the till shows before the exchange is sent.
// Dependency-free (no imports, no DOM/React) so `libs/customer-voucher-issue.test.mjs`
// runs under node --experimental-strip-types and the Runner can copy this file
// (scripts/sync-sale-core.mjs).

// D-24 — linear rate 100 P per $1, no bonus for larger tiers; validity (Sydney
// end of day + 14 days) is CRM's. `amount` is cents (what the server and CRM
// receive), `points` is what CRM deducts.
export interface CustomerVoucherTier {
  amount: number;
  points: number;
  label: string;
}

export const CUSTOMER_VOUCHER_TIERS: readonly CustomerVoucherTier[] = [
  { amount: 1000, points: 1000, label: "$10" },
  { amount: 2500, points: 2500, label: "$25" },
  { amount: 5000, points: 5000, label: "$50" },
  { amount: 10000, points: 10000, label: "$100" },
];

function finitePoints(points: number): number | null {
  return typeof points === "number" && Number.isFinite(points) ? points : null;
}

// Tiers the member's points cover, smallest first (an unknown balance covers none).
export function affordableVoucherTiers(points: number): CustomerVoucherTier[] {
  const p = finitePoints(points);
  if (p === null) return [];
  return CUSTOMER_VOUCHER_TIERS.filter((tier) => tier.points <= p);
}

// Points the member still needs for this tier; 0 when it is affordable.
export function voucherTierShortfall(points: number, tier: CustomerVoucherTier): number {
  const p = finitePoints(points);
  if (p === null) return tier.points;
  return Math.max(0, tier.points - p);
}

// Can the member exchange at all = can afford the smallest tier ($10).
export function canExchangePoints(points: number): boolean {
  return affordableVoucherTiers(points).length > 0;
}

// "2,500 P" — grouping without Intl so the till and the Runner render the same.
export function formatVoucherPoints(points: number): string {
  const n = Math.trunc(points);
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}${digits} P`;
}

// Tier row: "$25 · 2,500 P".
export function voucherTierRowLabel(tier: CustomerVoucherTier): string {
  return `${tier.label} · ${formatVoucherPoints(tier.points)}`;
}

// Disabled tier row note: "needs 1,500 P more".
export function voucherTierShortfallLabel(points: number, tier: CustomerVoucherTier): string {
  return `needs ${formatVoucherPoints(voucherTierShortfall(points, tier))} more`;
}

// Confirmation 1 (amount, points deducted, balance after) and confirmation 2
// (irreversible) — the exchange is sent only after both. `title` + `lines`
// joined by spaces read as one sentence, e.g. "Issue a $25 voucher? 2,500 P
// will be deducted. Member balance after: 1,234 P".
export interface VoucherConfirmText {
  title: string;
  lines: string[];
  confirmLabel: string;
}

export function voucherIssueConfirmText(
  tier: CustomerVoucherTier,
  memberPoints: number,
): { first: VoucherConfirmText; second: VoucherConfirmText } {
  const after = Math.max(0, (finitePoints(memberPoints) ?? 0) - tier.points);
  return {
    first: {
      title: `Issue a ${tier.label} voucher?`,
      lines: [
        `${formatVoucherPoints(tier.points)} will be deducted.`,
        `Member balance after: ${formatVoucherPoints(after)}`,
      ],
      confirmLabel: "Continue",
    },
    second: {
      title: "This cannot be undone.",
      lines: [`Issue the ${tier.label} voucher now?`],
      confirmLabel: `Issue ${tier.label}`,
    },
  };
}

export interface IssueAnswerVoucher {
  serial: string;
}

export interface IssueAnswer<V extends IssueAnswerVoucher> {
  ok: boolean;
  msg?: string;
  result: { voucher: V; memberPoints: number | null; replayed?: boolean } | null;
}

export type IssueDecision<V extends IssueAnswerVoucher> =
  | { action: "select"; voucher: V; memberPoints: number | null }
  | { action: "recovered"; notice: string; memberPoints: number | null }
  | { action: "error"; message: string };

export function decideIssueAnswer<V extends IssueAnswerVoucher>(
  res: IssueAnswer<V>,
): IssueDecision<V> {
  if (!res.ok || !res.result) {
    return { action: "error", message: res.msg || "Failed to issue voucher" };
  }
  if (res.result.replayed === true) {
    return {
      action: "recovered",
      notice: `Earlier exchange recovered — voucher ${res.result.voucher.serial}`,
      memberPoints: pointsOrNull(res.result.memberPoints),
    };
  }
  return {
    action: "select",
    voucher: res.result.voucher,
    memberPoints: pointsOrNull(res.result.memberPoints),
  };
}

function pointsOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// The member's points after an ok exchange answer: the answer's own value, or
// — when a replay could not read it (null) — a fresh read of the member.
// null when that read fails too (the caller keeps what it shows).
export async function memberPointsAfterIssue(
  memberPoints: number | null,
  refetchMemberPoints: () => Promise<number | null>,
): Promise<number | null> {
  if (memberPoints !== null) return memberPoints;
  try {
    return pointsOrNull(await refetchMemberPoints());
  } catch {
    return null;
  }
}

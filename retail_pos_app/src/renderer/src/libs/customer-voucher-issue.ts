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
// Dependency-free (types only) so `libs/customer-voucher-issue.test.mjs` runs
// under node --experimental-strip-types.

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

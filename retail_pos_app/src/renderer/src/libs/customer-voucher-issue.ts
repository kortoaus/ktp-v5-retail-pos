// T-17 / F-16 — what the till does with an answer to the points→voucher
// exchange press. A fresh issue is selected for payment straight away (as
// before). A replay (`replayed: true`: an earlier press already issued this
// voucher, its answer was lost) is NOT auto-selected — the recovered voucher
// may since be spent, expired or already in this sale. The modal refreshes the
// member's valid vouchers, shows one notice line and the cashier picks an
// eligible voucher from the list. The attempt is settled by the service
// (sendWithOperation) either way.
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
  | { action: "select"; voucher: V; memberPoints: number | undefined }
  | { action: "recovered"; notice: string }
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
    };
  }
  return {
    action: "select",
    voucher: res.result.voucher,
    memberPoints: res.result.memberPoints ?? undefined,
  };
}

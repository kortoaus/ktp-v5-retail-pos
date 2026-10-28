// The approved card payment joins the PaymentModal's tender queue (retail-eftpos
// T-7). The queue reducer (libs/sale/tender-queue.ts) is shared sale core —
// copied by the Runner — so this lives beside it as a wrapper action instead
// of a new case inside it. The payment row keeps its shape: {tender: CREDIT,
// amount} (`amount` = what the terminal charged, from `resultAmounts`; the
// server re-derives surcharge/rounding as for a keyed CREDIT). The staged
// CREDIT draft (the keyed request amount) is cleared so it is not counted twice.
import {
  makeDefaultStage,
  type TenderCustomerVoucher,
  type TenderState,
  type TenderUserVoucher,
} from "../sale/tender-queue";

export type EftTenderAction =
  | { type: "eft-approved"; key: string; amountCents: number }
  // A-28 (F-12): an unsuccessful terminal outcome (declined, cancelled,
  // override No, approved-but-different, not sent) drops the keyed CREDIT
  // draft, so COMPLETE cannot record it; manual credit needs a fresh re-key.
  | { type: "eft-clear-credit-draft" };

export function applyEftTenderAction<UV extends TenderUserVoucher, CV extends TenderCustomerVoucher>(
  state: TenderState<UV, CV>,
  action: EftTenderAction,
): TenderState<UV, CV> {
  return action.type === "eft-approved" ? addApprovedCredit(state, action) : clearCreditDraft(state);
}

export function clearCreditDraft<UV extends TenderUserVoucher, CV extends TenderCustomerVoucher>(
  state: TenderState<UV, CV>,
): TenderState<UV, CV> {
  if (state.staged.tender !== "CREDIT" || state.staged.amount === 0) return state;
  return { ...state, staged: makeDefaultStage("CREDIT") };
}

export function addApprovedCredit<UV extends TenderUserVoucher, CV extends TenderCustomerVoucher>(
  state: TenderState<UV, CV>,
  action: Extract<EftTenderAction, { type: "eft-approved" }>,
): TenderState<UV, CV> {
  if (!Number.isInteger(action.amountCents) || action.amountCents <= 0) return state;
  if (state.payments.some((p) => p.key === action.key)) return state;
  return {
    ...state,
    staged: makeDefaultStage("CREDIT"),
    stagedVoucher: null,
    stagedVoucherUserName: null,
    stagedCustomerVoucher: null,
    payments: [...state.payments, { key: action.key, tender: "CREDIT", amount: action.amountCents }],
  };
}

/** Txn ids already in the payment list (key → txn id map, pruned to live keys). */
export function appliedTxnIds(
  payments: readonly { key: string }[],
  byKey: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = [];
  for (const p of payments) {
    const id = byKey.get(p.key);
    if (id) out.push(id);
  }
  return out;
}

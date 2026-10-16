// Tender queue — the PaymentModal's tender state as a pure reducer plus a
// selector for everything derived from it (retail-runner T-1, D-2). No DOM,
// no React, no service calls: the POS modal holds this state with
// useReducer, Runner copies the file verbatim (sync-sale-core).
//
// State   : staged draft + committed queue + the staged voucher objects +
//           SPEND mode.
// Derived : selectTender → calcPayment (usePaymentCal.ts stays the math
//           core: 5¢ cash rounding, surcharge, remaining, change, points),
//           the input cap `left`, EXACT cash, the display list with cash FIFO
//           allocation, per-slot sums, tender locks, COMPLETE gating.
// Prompts : the confirm texts are built here; the UI shows them and only
//           dispatches when the cashier agrees.
//
// Money in cents. Surcharge rate is per-1000 (15 = 1.5%).

import type { PaymentQueueItem } from "../../screens/SaleScreen/PaymentModal/types";
import type { SaleLineType } from "../../types/sales";
import type { StoreSetting } from "../../types/models";
import {
  billPortionOf,
  calcLeft,
  calcPayment,
  eftposAmountOf,
  round5,
  type PaymentCal,
} from "../../screens/SaleScreen/PaymentModal/usePaymentCal";
import { MONEY_DP, MONEY_SCALE } from "../constants";

// ── Slots ──────────────────────────────────────────────────────
// UI-level tender slot. Distinct from PaymentType in the schema:
//   USER_VOUCHER + CUSTOMER_VOUCHER both map to tender="VOUCHER" in the
//   PaymentQueueItem (and SaleInvoicePayment), discriminated by entityType.
export type TenderSlot =
  | "CASH"
  | "CREDIT"
  | "USER_VOUCHER"
  | "CUSTOMER_VOUCHER"
  | "GIFTCARD";

export const EXACT_TENDER_SLOTS: TenderSlot[] = ["CREDIT", "GIFTCARD"];

// Summary 패널 — tender 별 합계 표시용 라벨.
export const TENDER_LABEL: Record<TenderSlot, string> = {
  CASH: "Cash",
  CREDIT: "Credit",
  USER_VOUCHER: "Staff Voucher",
  CUSTOMER_VOUCHER: "Customer Voucher",
  GIFTCARD: "Gift Card",
};

// Picker order: the voucher slot leads (Customer Voucher for a member cart,
// Staff Voucher otherwise), then cash, then the exact tenders.
export function paymentTypesFor(hasMember: boolean): TenderSlot[] {
  return [hasMember ? "CUSTOMER_VOUCHER" : "USER_VOUCHER", "CASH", ...EXACT_TENDER_SLOTS];
}

export const fmtMoney = (cents: number) =>
  (cents / MONEY_SCALE).toFixed(MONEY_DP);

export const userVoucherEntityLabel = (userName: string, expectedBalance: number) =>
  `${userName} - Est. balance $${fmtMoney(Math.max(0, expectedBalance))}`;

// Empty draft for each slot. `key: "staged"` is a fixed marker — when the
// staged item is committed to `payments`, a uuid replaces it. Never two
// staged items, so no key collision risk.
export function makeDefaultStage(slot: TenderSlot): PaymentQueueItem {
  switch (slot) {
    case "CASH":
      return { key: "staged", tender: "CASH", amount: 0, cashReceived: 0 };
    case "CREDIT":
      return { key: "staged", tender: "CREDIT", amount: 0 };
    case "GIFTCARD":
      return { key: "staged", tender: "GIFTCARD", amount: 0 };
    case "USER_VOUCHER":
      return {
        key: "staged",
        tender: "VOUCHER",
        amount: 0,
        entityType: "user-voucher",
        entityId: 0,
        entityLabel: "",
      };
    case "CUSTOMER_VOUCHER":
      return {
        key: "staged",
        tender: "VOUCHER",
        amount: 0,
        entityType: "customer-voucher",
        entityId: 0,
        entityLabel: "",
      };
  }
}

// Derive UI slot from a staged/committed item — needed because VOUCHER tender
// covers two UI slots.
export function slotOf(p: PaymentQueueItem): TenderSlot {
  if (p.tender === "VOUCHER") {
    return p.entityType === "user-voucher" ? "USER_VOUCHER" : "CUSTOMER_VOUCHER";
  }
  return p.tender; // CASH | CREDIT | GIFTCARD
}

export function isVoucherSlot(slot: TenderSlot): boolean {
  return slot === "USER_VOUCHER" || slot === "CUSTOMER_VOUCHER";
}

export function isExactTenderPayment(p: PaymentQueueItem): boolean {
  return p.tender === "CREDIT" || p.tender === "GIFTCARD";
}

// "Has the cashier put anything into this draft yet?" CASH uses cashReceived
// because amount is derived (allocation). Others use amount as the source.
export function isStagedActive(p: PaymentQueueItem): boolean {
  if (p.tender === "CASH") return p.cashReceived > 0;
  return p.amount > 0;
}

// Non-cash staged (CREDIT / GIFTCARD / VOUCHER) that is ready goes into the
// payload as if committed → no ADD press needed (1-step Complete). CASH staged
// is already inside cal.cashApplied, so it is never returned here.
export function readyStagedPayment(staged: PaymentQueueItem): PaymentQueueItem | undefined {
  const ready =
    isStagedActive(staged) &&
    staged.tender !== "CASH" &&
    staged.amount > 0 &&
    (staged.tender !== "VOUCHER" || staged.entityId > 0);
  return ready ? staged : undefined;
}

// ── Store rates ────────────────────────────────────────────────
export interface TenderRates {
  creditSurchargeRate: number; // per-1000: 15 = 1.5%, 150 = 15%
  cashPointRate: number;
  otherPointRate: number;
}

// Fallbacks when the store setting is not loaded (or a rate is null).
export function tenderRates(
  setting:
    | Pick<StoreSetting, "credit_surcharge_rate" | "cash_point_rate" | "other_point_rate">
    | null
    | undefined,
): TenderRates {
  return {
    creditSurchargeRate: setting?.credit_surcharge_rate ?? 15,
    cashPointRate: setting?.cash_point_rate ?? 10,
    otherPointRate: setting?.other_point_rate ?? 10,
  };
}

// ── State ──────────────────────────────────────────────────────
// The staged voucher objects are held whole (the input components need them)
// but the reducer only reads these fields.
export interface TenderUserVoucher {
  id: number;
  balance: number;
}
export interface TenderCustomerVoucher {
  id: number;
  label: string;
}

export interface TenderState<
  UV extends TenderUserVoucher = TenderUserVoucher,
  CV extends TenderCustomerVoucher = TenderCustomerVoucher,
> {
  staged: PaymentQueueItem;
  payments: PaymentQueueItem[];
  // Live voucher for the staged Staff Voucher (PaymentQueueItem only carries
  // entityId/entityLabel — not balance). Cleared on slot change or commit.
  stagedVoucher: UV | null;
  stagedVoucherUserName: string | null;
  stagedCustomerVoucher: CV | null;
  // Member points after a points → voucher exchange (F-17), else null.
  customerVoucherMemberPoints: number | null;
  // SPEND (internal consumption) mode: tender picker off, RECORD SPEND button.
  spendMode: boolean;
}

export function createTenderState<
  UV extends TenderUserVoucher = TenderUserVoucher,
  CV extends TenderCustomerVoucher = TenderCustomerVoucher,
>(): TenderState<UV, CV> {
  return {
    staged: makeDefaultStage("CASH"),
    payments: [],
    stagedVoucher: null,
    stagedVoucherUserName: null,
    stagedCustomerVoucher: null,
    customerVoucherMemberPoints: null,
    spendMode: false,
  };
}

export type TenderAction<
  UV extends TenderUserVoucher = TenderUserVoucher,
  CV extends TenderCustomerVoucher = TenderCustomerVoucher,
> =
  // Toggling SPEND resets staged / committed / vouchers (no hidden state).
  | { type: "toggle-spend" }
  // The cart's member changed: every tender belongs to the previous member.
  | { type: "member-changed" }
  // Switch slot, discarding the draft (the UI confirms a non-empty draft first).
  | { type: "change-slot"; slot: TenderSlot }
  // Commit the draft with a fresh key (the caller mints it, e.g. a UUID).
  | { type: "commit-staged"; key: string }
  | { type: "remove-payment"; key: string }
  | { type: "set-cash-received"; cashReceived: number }
  // CREDIT: the input sends the BILL portion; stored as the EFTPOS amount.
  | { type: "set-credit-bill"; billPortion: number; left: number; surchargeRate: number }
  // `left` shrank (another tender grew): clamp a staged CREDIT to it.
  | { type: "clamp-credit"; left: number; surchargeRate: number }
  | { type: "set-giftcard-amount"; amount: number; left: number }
  | { type: "select-user-voucher"; user: { id: number; name: string }; voucher: UV }
  | { type: "set-user-voucher-amount"; amount: number }
  | { type: "select-customer-voucher"; voucher: CV }
  | { type: "set-customer-voucher-amount"; amount: number }
  | { type: "set-customer-voucher-member-points"; memberPoints: number };

function withFreshStage<UV extends TenderUserVoucher, CV extends TenderCustomerVoucher>(
  state: TenderState<UV, CV>,
  slot: TenderSlot,
): TenderState<UV, CV> {
  return {
    ...state,
    staged: makeDefaultStage(slot),
    stagedVoucher: null,
    stagedVoucherUserName: null,
    stagedCustomerVoucher: null,
  };
}

// Voucher must lead tender order. Cash can follow voucher and absorb rounding,
// but exact tenders lock further cash because mixed exact payments settle at 1¢.
export function voucherLockedOf(payments: PaymentQueueItem[]): boolean {
  return payments.some((p) => p.tender !== "VOUCHER");
}
export function cashLockedOf(payments: PaymentQueueItem[]): boolean {
  return payments.some(isExactTenderPayment);
}

function slotAllowed(payments: PaymentQueueItem[], slot: TenderSlot): boolean {
  if (isVoucherSlot(slot) && voucherLockedOf(payments)) return false;
  if (slot === "CASH" && cashLockedOf(payments)) return false;
  return true;
}

export function tenderReducer<
  UV extends TenderUserVoucher = TenderUserVoucher,
  CV extends TenderCustomerVoucher = TenderCustomerVoucher,
>(state: TenderState<UV, CV>, action: TenderAction<UV, CV>): TenderState<UV, CV> {
  switch (action.type) {
    case "toggle-spend":
      return {
        ...withFreshStage(state, "CASH"),
        spendMode: !state.spendMode,
        payments: [],
      };

    case "member-changed":
      return {
        ...withFreshStage(state, "CASH"),
        payments: [],
        customerVoucherMemberPoints: null,
      };

    case "change-slot": {
      if (!slotAllowed(state.payments, action.slot)) return state;
      if (slotOf(state.staged) === action.slot) return state;
      return withFreshStage(state, action.slot);
    }

    // Resets the draft to a fresh default of the same slot so the cashier can
    // keep adding the same tender (multi-cash splits). For CASH the stored
    // amount is irrelevant (re-derived via cashAllocations). Duplicate
    // vouchers are blocked at SELECTION (used ids are disabled in the search
    // modal), not here.
    case "commit-staged": {
      const p = state.staged;
      if (!isStagedActive(p)) return state;
      if (p.tender !== "CASH" && p.amount <= 0) return state;
      // VOUCHER needs an entity (entityId 0 = none selected)
      if (p.tender === "VOUCHER" && p.entityId <= 0) return state;
      return {
        ...withFreshStage(state, slotOf(p)),
        payments: [...state.payments, { ...p, key: action.key }],
      };
    }

    case "remove-payment": {
      const payments = state.payments.filter((p) => p.key !== action.key);
      if (payments.length === state.payments.length) return state;
      return { ...state, payments };
    }

    // CASH amount is derived (cashAllocations) — pinned to 0 here.
    case "set-cash-received":
      return {
        ...state,
        staged: { key: "staged", tender: "CASH", cashReceived: action.cashReceived, amount: 0 },
      };

    // Hard cap on the bill portion; the EFTPOS amount comes from the one
    // helper display also uses, so the two never differ by 1¢.
    case "set-credit-bill": {
      const cappedBill = Math.min(action.billPortion, action.left);
      return {
        ...state,
        staged: {
          key: "staged",
          tender: "CREDIT",
          amount: eftposAmountOf(cappedBill, action.surchargeRate),
        },
      };
    }

    case "clamp-credit": {
      const prev = state.staged;
      if (prev.tender !== "CREDIT") return state;
      const bill = billPortionOf(prev, action.surchargeRate);
      if (bill <= action.left) return state;
      const next = eftposAmountOf(action.left, action.surchargeRate);
      if (next === prev.amount) return state;
      return { ...state, staged: { ...prev, amount: next } };
    }

    // No surcharge — keyed as-is on the EFTPOS machine. Hard cap (= bill).
    case "set-giftcard-amount":
      return {
        ...state,
        staged: {
          key: "staged",
          tender: "GIFTCARD",
          amount: Math.min(action.amount, action.left),
        },
      };

    // Amount starts at 0 — the cashier keys how much to use; the input caps it
    // at min(left, balance).
    case "select-user-voucher":
      return {
        ...state,
        stagedVoucher: action.voucher,
        stagedVoucherUserName: action.user.name,
        staged: {
          key: "staged",
          tender: "VOUCHER",
          entityType: "user-voucher",
          entityId: action.voucher.id,
          entityLabel: userVoucherEntityLabel(action.user.name, action.voucher.balance),
          amount: 0,
        },
      };

    case "set-user-voucher-amount": {
      const prev = state.staged;
      if (prev.tender !== "VOUCHER") return state;
      if (prev.entityType !== "user-voucher" || !state.stagedVoucherUserName) {
        return { ...state, staged: { ...prev, amount: action.amount } };
      }
      const expectedBalance = (state.stagedVoucher?.balance ?? 0) - action.amount;
      return {
        ...state,
        staged: {
          ...prev,
          amount: action.amount,
          entityLabel: userVoucherEntityLabel(state.stagedVoucherUserName, expectedBalance),
        },
      };
    }

    case "select-customer-voucher":
      return {
        ...state,
        stagedCustomerVoucher: action.voucher,
        staged: {
          key: "staged",
          tender: "VOUCHER",
          entityType: "customer-voucher",
          entityId: action.voucher.id,
          entityLabel: action.voucher.label,
          amount: 0,
        },
      };

    case "set-customer-voucher-amount": {
      const prev = state.staged;
      if (prev.tender !== "VOUCHER") return state;
      if (prev.entityType !== "customer-voucher") return state;
      return { ...state, staged: { ...prev, amount: action.amount } };
    }

    case "set-customer-voucher-member-points":
      return { ...state, customerVoucherMemberPoints: action.memberPoints };
  }
}

// ── Prompts ────────────────────────────────────────────────────
export type ChangeSlotDecision =
  | { kind: "ignore" }
  | { kind: "switch" }
  | { kind: "confirm"; message: string };

// Switching discards the draft; a non-empty draft is confirmed first so a
// mis-tap does not lose an entry.
export function changeSlotDecision(
  state: Pick<TenderState, "staged" | "payments">,
  slot: TenderSlot,
): ChangeSlotDecision {
  if (!slotAllowed(state.payments, slot)) return { kind: "ignore" };
  const currentSlot = slotOf(state.staged);
  if (currentSlot === slot) return { kind: "ignore" };
  if (!isStagedActive(state.staged)) return { kind: "switch" };
  const draftDisp =
    state.staged.tender === "CASH" ? state.staged.cashReceived : state.staged.amount;
  return {
    kind: "confirm",
    message: `Discard staged ${currentSlot.replace("_", " ")} ($${fmtMoney(draftDisp)}) and switch to ${slot.replace("_", " ")}?`,
  };
}

// Confirm text for removing a committed payment; null when the key is gone.
export function removePaymentPrompt(
  payments: PaymentQueueItem[],
  key: string,
): string | null {
  const p = payments.find((pp) => pp.key === key);
  if (!p) return null;
  const label = p.tender === "GIFTCARD" ? "GIFT CARD" : p.tender;
  const disp = p.tender === "CASH" ? p.cashReceived : p.amount;
  return `Remove ${label} payment ($${fmtMoney(disp)})?`;
}

// ── Selector ───────────────────────────────────────────────────
export interface TenderView {
  cal: PaymentCal;
  // Cap for the active tender input, from committed payments only.
  left: number;
  // EXACT button: round5(left) while no exact tender is committed (cash-only
  // and voucher+cash settle on 5¢); plain left once card/gift card is in.
  exactCashAmount: number;
  // Display list: empty draft dropped, CASH amounts = FIFO allocation.
  derivedPayments: PaymentQueueItem[];
  // Per-slot sums of derivedPayments (active draft included).
  tenderSums: Map<TenderSlot, number>;
  usedUserVoucherIds: number[];
  usedCustomerVoucherIds: number[];
  voucherLocked: boolean;
  cashLocked: boolean;
  // COMPLETE needs lines, nothing remaining and a positive total.
  completeDisabled: boolean;
}

export function selectTender(
  state: Pick<TenderState, "staged" | "payments">,
  ctx: { lines: SaleLineType[]; rates: TenderRates; hasMember: boolean },
): TenderView {
  const { staged, payments } = state;
  const { lines, rates, hasMember } = ctx;

  // Always include staged so the math sees the tender presence (e.g. CASH
  // staged at $0 should still trigger rounding).
  const combinedPayments = [staged, ...payments];

  const cal = calcPayment({
    lines,
    credit_surcharge_rate: rates.creditSurchargeRate,
    cash_point_rate: rates.cashPointRate,
    other_point_rate: rates.otherPointRate,
    hasMember,
    payments: combinedPayments,
  });

  const left = calcLeft(payments, cal.due, rates.creditSurchargeRate);
  const exactCashAmount = payments.some(isExactTenderPayment) ? left : round5(left);

  const derivedPayments = combinedPayments
    .filter((p) => p.key !== "staged" || isStagedActive(p))
    .map((p) =>
      p.tender === "CASH" ? { ...p, amount: cal.cashAllocations.get(p.key) ?? 0 } : p,
    );

  const tenderSums = new Map<TenderSlot, number>();
  for (const p of derivedPayments) {
    const slot = slotOf(p);
    tenderSums.set(slot, (tenderSums.get(slot) ?? 0) + p.amount);
  }

  const usedIds = (entityType: "user-voucher" | "customer-voucher") =>
    payments.flatMap((p) =>
      p.tender === "VOUCHER" && p.entityType === entityType ? [p.entityId] : [],
    );

  return {
    cal,
    left,
    exactCashAmount,
    derivedPayments,
    tenderSums,
    usedUserVoucherIds: usedIds("user-voucher"),
    usedCustomerVoucherIds: usedIds("customer-voucher"),
    voucherLocked: voucherLockedOf(payments),
    cashLocked: cashLockedOf(payments),
    completeDisabled: lines.length === 0 || cal.remaining !== 0 || cal.total <= 0,
  };
}

// Sale submission — payload, operation id, replay detection and the
// completed-sale shape (retail-runner T-1, D-2). No DOM, no HTTP client: the
// request function is injected (POS: the sale service's postSale over
// axios; Runner: its own client). Runner copies this file verbatim.
//
// Operation identity (T-15, platform/D-10): one attempt per cart slot. The
// attempt's operationId is resent on every retry until the server settles it
// (libs/operation-id.ts), so a retry after a lost answer replays the recorded
// Invoice (`replayed: true`) instead of charging twice.

import type { Cart } from "../../store/SalesStore.helper";
import type { PaymentQueueItem } from "../../screens/SaleScreen/PaymentModal/types";
import type { SaleCreatePayload } from "./payload.types";
import { buildSalePayload, buildSpendPayload, type BuildPayloadCal } from "./build-payload";
import { readyStagedPayment } from "./tender-queue";
import { operationIdFor, saleAttemptKey, settleOperation } from "../operation-id";

export type OrderCollectResult = "collected" | "pending" | "conflict";

// What the till reads from the server's created/replayed Invoice.
export interface SaleSubmitAnswer {
  id: number;
  serial: string | null;
  // S3 — C&C order sales only; collectSynced is the older boolean.
  collectResult?: OrderCollectResult;
  collectSynced?: boolean;
  // T-15 — the server already had this operationId.
  replayed?: boolean;
}

export interface SubmitResponse<T> {
  ok: boolean;
  msg: string;
  status?: number;
  result?: T | null;
}

export type SaleBody = SaleCreatePayload & { operationId: string };

export const SALE_MESSAGES = {
  saleFailed: "Failed to complete sale",
  spendFailed: "Failed to record spend",
  spendConfirm:
    "Record these items as internal consumption (SPEND)? This is not a sale.",
} as const;

// One request under the cart slot's attempt: send with the attempt's id, then
// settle it by the answer (ok or a settling 409 ends it; network errors,
// timeouts, 5xx and OPERATION_IN_PROGRESS keep it for the retry).
export async function sendSaleWithOperation<R extends SubmitResponse<unknown>>(
  payload: SaleCreatePayload,
  cartIndex: number,
  request: (body: SaleBody) => Promise<R>,
): Promise<R> {
  const attemptKey = saleAttemptKey(cartIndex);
  const operationId = operationIdFor(attemptKey);
  const res = await request({ ...payload, operationId });
  settleOperation(attemptKey, res);
  return res;
}

// Snapshot shown by the completion overlay (ChangeOverlay) and used for the
// receipt. memberPointsBefore is the CRM balance before the cart (and its
// member) is cleared — receipt Total Points = before + earned; never stored.
export interface CompletedSaleInfo<I extends SaleSubmitAnswer = SaleSubmitAnswer> {
  invoice: I;
  total: number;
  paid: number;
  cashReceived: number;
  change: number;
  receiptPrinted: boolean;
  memberPointsBefore: number | null;
  // S3 — collect result of an order-loaded sale; null = no order.
  order: { orderNo: string; collectResult: OrderCollectResult } | null;
}

export type SubmitSaleCal = BuildPayloadCal & { paid: number; cashIntent: number };

export type SubmitSaleOutcome<I extends SaleSubmitAnswer> =
  | { ok: false; message: string }
  | {
      ok: true;
      invoice: I;
      // Shown once when the server replayed an already-recorded sale.
      replayNotice: string | null;
      completed: CompletedSaleInfo<I>;
    };

export function replayNoticeOf(invoice: SaleSubmitAnswer): string | null {
  if (!invoice.replayed) return null;
  return `This sale was already recorded (${invoice.serial ?? `#${invoice.id}`}) — nothing was charged twice.`;
}

// Older servers (before the tri-state) send only collectSynced; all absent =
// pending (the sweep retries).
export function collectResultOf(invoice: SaleSubmitAnswer): OrderCollectResult {
  return invoice.collectResult ?? (invoice.collectSynced === true ? "collected" : "pending");
}

export function completedSaleInfo<I extends SaleSubmitAnswer>(
  invoice: I,
  cart: Cart,
  cal: Pick<SubmitSaleCal, "total" | "paid" | "cashIntent" | "change">,
): CompletedSaleInfo<I> {
  return {
    invoice,
    total: cal.total,
    paid: cal.paid,
    // cashIntent (not cashApplied): what the customer handed over.
    cashReceived: cal.cashIntent,
    change: cal.change,
    receiptPrinted: false,
    memberPointsBefore: cart.member?.points ?? null,
    order: cart.externalOrderId
      ? {
          orderNo: cart.orderNo ?? cart.externalOrderId,
          collectResult: collectResultOf(invoice),
        }
      : null,
  };
}

// Complete Sale. The cart is snapshotted before the request so the payload
// and the order info describe exactly what was sent. A ready non-cash staged
// draft is included as if committed (1-step Complete).
export async function submitSale<I extends SaleSubmitAnswer>(
  input: {
    cart: Cart;
    cartIndex: number;
    cal: SubmitSaleCal;
    payments: PaymentQueueItem[];
    stagedPayment: PaymentQueueItem;
  },
  request: (body: SaleBody) => Promise<SubmitResponse<I>>,
): Promise<SubmitSaleOutcome<I>> {
  const cart: Cart = {
    ...input.cart,
    lines: input.cart.lines.map((line) => ({ ...line })),
  };
  const payload = buildSalePayload({
    cart,
    cal: input.cal,
    payments: input.payments,
    stagedPayment: readyStagedPayment(input.stagedPayment),
  });

  const res = await sendSaleWithOperation(payload, input.cartIndex, request);
  if (!res.ok || !res.result) {
    return { ok: false, message: res.msg || SALE_MESSAGES.saleFailed };
  }
  return {
    ok: true,
    invoice: res.result,
    replayNotice: replayNoticeOf(res.result),
    completed: completedSaleInfo(res.result, cart, input.cal),
  };
}

// SPEND (internal consumption): items only, every amount 0, no payments. The
// caller confirms first (SALE_MESSAGES.spendConfirm).
//
// T-10 (F-27): the request carries the cart slot's attempt operationId — the
// SAME attempt as a Sale from that slot (saleAttemptKey): one cart is one
// transaction whatever its kind, so a Spend pressed after a Sale whose answer
// was lost (or the reverse) gets a 409 naming the recorded invoice instead of
// recording the cart twice. Retries resend the id until the server settles
// it; a replay returns the recorded SPEND (`replayed`).
export type SpendBody = SaleCreatePayload & { operationId: string };

export async function submitSpend<I extends { id: number; replayed?: boolean }>(
  input: { cart: Cart; cartIndex: number },
  request: (body: SpendBody) => Promise<SubmitResponse<I>>,
): Promise<{ ok: false; message: string } | { ok: true; invoice: I; replayed: boolean }> {
  const res = await sendSaleWithOperation(
    buildSpendPayload({ cart: input.cart }),
    input.cartIndex,
    request,
  );
  if (!res.ok || !res.result) {
    return { ok: false, message: res.msg || SALE_MESSAGES.spendFailed };
  }
  return { ok: true, invoice: res.result, replayed: res.result.replayed === true };
}

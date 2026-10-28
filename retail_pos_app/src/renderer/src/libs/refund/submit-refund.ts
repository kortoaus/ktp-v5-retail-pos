// Refund submission — operation id discipline for POST /api/sale/refund
// (retail-runner T-16, S-4 §3). No DOM, no HTTP client: the request function
// is injected (POS: the sale service's createRefundInvoice over axios, with
// trackCheckout and the client's 30 s timeout; Runner: its own client), like
// libs/sale/submit-sale.ts. Runner copies this file verbatim.
//
// One attempt per original invoice (`refund:invoice:<originalId>`,
// libs/operation-id.ts): the attempt's operationId is resent on every retry
// until the server settles it — ok, or a 409 OPERATION_CANCELLED /
// OPERATION_PAYLOAD_MISMATCH ends the attempt; network errors, timeouts, 5xx,
// 503 (CRM offline) and 409 OPERATION_IN_PROGRESS keep it, so a retry after a
// lost answer replays the recorded REFUND invoice instead of refunding twice.

import {
  operationIdFor,
  refundAttemptKey,
  settleOperation,
} from "../operation-id";
import type { RefundCreatePayload } from "./payload.types";

export type RefundBody = RefundCreatePayload & { operationId: string };

export async function sendRefundWithOperation<
  R extends { ok: boolean; result?: unknown },
>(
  payload: RefundCreatePayload,
  request: (body: RefundBody) => Promise<R>,
): Promise<R> {
  const attemptKey = refundAttemptKey(payload.originalInvoiceId);
  const operationId = operationIdFor(attemptKey);
  const res = await request({ ...payload, operationId });
  settleOperation(attemptKey, res);
  return res;
}

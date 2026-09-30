// npm run test:orders
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRefundRequestPayload,
  canRequestRefund,
  defaultRefundQtys,
  draftAmount,
  linesRefundAmount,
  makeRequestKey,
  MANUAL_REFUND_REASONS,
  openRequestsWarning,
  refundRequestErrorMessage,
  refundRequestLine,
  validateRefundDraft,
} from "./refund-request-policy.ts";

const captured = { paymentMethod: "STRIPE", payment: { state: "CAPTURED", refundDue: false, lastError: null } };
const LINES = [
  { id: 1, qty: 3, pickedQty: 2, unitPrice: 2450, deliverySurchargePerUnit: 0 },
  { id: 2, qty: 2, pickedQty: 2, unitPrice: 1000, deliverySurchargePerUnit: 50 },
  { id: 3, qty: 1, pickedQty: null, unitPrice: 500, deliverySurchargePerUnit: 0 },
];

test("Request refund needs refund_ticket (or admin) + captured online payment", () => {
  assert.equal(canRequestRefund(captured, ["refund_ticket"]), true);
  assert.equal(canRequestRefund(captured, ["admin"]), true);
  assert.equal(canRequestRefund(captured, ["sale", "refund"]), false);
  assert.equal(canRequestRefund({ ...captured, payment: { ...captured.payment, state: "PARTIALLY_REFUNDED" } }, ["refund_ticket"]), true);
  assert.equal(canRequestRefund({ ...captured, payment: { ...captured.payment, state: "AUTHORIZED" } }, ["refund_ticket"]), false);
  assert.equal(canRequestRefund({ ...captured, paymentMethod: "IN_STORE" }, ["refund_ticket"]), false);
});

test("manual reasons never include the SYSTEM-only REJECTED_AFTER_CAPTURE", () => {
  assert.deepEqual([...MANUAL_REFUND_REASONS], ["PICKING_SHORTFALL", "CUSTOMER_REQUEST", "OTHER"]);
});

test("steppers default to the picking shortfall; amount = qty × (unit + surcharge)", () => {
  const qtys = defaultRefundQtys(LINES);
  assert.deepEqual([...qtys], [[1, 1], [2, 0], [3, 0]]);
  assert.equal(linesRefundAmount(LINES, qtys), 2450);
  assert.equal(linesRefundAmount(LINES, new Map([[2, 2]])), 2100);
});

const draft = (over = {}) => ({ mode: "lines", qtys: new Map([[1, 1]]), customCents: 0, reason: "PICKING_SHORTFALL", note: "", ...over });

test("draft amount by mode and validation", () => {
  assert.equal(draftAmount(draft(), LINES, 8420), 2450);
  assert.equal(draftAmount(draft({ mode: "whole" }), LINES, 8420), 8420);
  assert.equal(draftAmount(draft({ mode: "custom", customCents: 1234 }), LINES, 8420), 1234);
  assert.equal(validateRefundDraft(draft(), LINES, 8420), null);
  assert.equal(validateRefundDraft(draft({ qtys: new Map() }), LINES, 8420), "Choose items or an amount.");
  assert.equal(validateRefundDraft(draft(), LINES, 1000), "Only $10.00 can still be refunded.");
  assert.equal(validateRefundDraft(draft({ reason: null }), LINES, 8420), "Choose a reason.");
  assert.equal(validateRefundDraft(draft({ reason: "OTHER", note: "  " }), LINES, 8420), "A note is required for Other.");
  assert.equal(validateRefundDraft(draft({ reason: "OTHER", note: "damaged" }), LINES, 8420), null);
});

test("payload: lines mode sends lines only, whole/custom send amount only", () => {
  assert.deepEqual(buildRefundRequestPayload(draft({ qtys: new Map([[1, 1], [2, 0]]), note: " short " }), "k", 8420), {
    requestKey: "k",
    reason: "PICKING_SHORTFALL",
    note: "short",
    lines: [{ lineId: 1, qty: 1 }],
  });
  assert.deepEqual(buildRefundRequestPayload(draft({ mode: "whole", reason: "CUSTOMER_REQUEST" }), "k", 8420), {
    requestKey: "k",
    reason: "CUSTOMER_REQUEST",
    amount: 8420,
  });
});

test("request key is a v4 uuid", () => {
  const key = makeRequestKey();
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(key, makeRequestKey());
});

const ticket = (over = {}) => ({
  id: 1, reason: "PICKING_SHORTFALL", status: "OPEN", requestedAmount: 2450, processedAmount: null, note: "",
  source: "POS", sourceTerminal: "Till 2", requestedByName: "Kim", lines: [], declineReason: null,
  processedAt: null, createdAt: "2026-09-24T05:00:00Z", processing: false, ...over,
});

test("ticket lines in the viewer", () => {
  assert.equal(refundRequestLine(ticket()).text, "Requested $24.50 · Picking shortfall · by Kim @ Till 2 · Waiting for office");
  assert.equal(refundRequestLine(ticket({ processing: true })).text, "Requested $24.50 · Picking shortfall · by Kim @ Till 2 · Processing…");
  assert.equal(refundRequestLine(ticket({ source: "SYSTEM", reason: "REJECTED_AFTER_CAPTURE" })).text, "Requested $24.50 · Rejected after charge · by System · Waiting for office");
  assert.equal(
    refundRequestLine(ticket({ status: "COMPLETED", processedAmount: 2000, processedAt: "2026-09-25T04:14:00Z" })).text,
    "Refunded $20.00 · Picking shortfall · 25/09/2026 2:14pm",
  );
  assert.equal(refundRequestLine(ticket({ status: "DECLINED", declineReason: "Customer kept it" })).text, "Declined $24.50 · Picking shortfall — Customer kept it");
});

test("open-request warning and error copy", () => {
  assert.equal(openRequestsWarning([ticket({ status: "COMPLETED" })]), null);
  assert.equal(openRequestsWarning([ticket({ requestedAmount: 1240 })]), "Another request is open: $12.40 (Picking shortfall)");
  assert.equal(refundRequestErrorMessage("AMOUNT_EXCEEDS_REFUNDABLE", { refundable: 1399 }), "Only $13.99 can still be refunded.");
  assert.equal(refundRequestErrorMessage("note is required for OTHER", null), "note is required for OTHER");
});

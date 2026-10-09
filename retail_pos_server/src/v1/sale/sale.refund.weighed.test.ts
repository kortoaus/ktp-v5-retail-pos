import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "../../libs/exceptions";
import { computeRefundRows, isWeighedRowType, type OrigInvoice } from "./sale.refund.service";

// F-23 / D-16 — rule retail-pos/refund-weighed-rows-whole-only: a weighed row
// is refunded whole (qty = the original qty) or not at all.

function original(type: string, qty: number, refunded_qty = 0): OrigInvoice {
  return {
    id: 70,
    type: "SALE",
    rows: [
      {
        id: 1,
        type,
        qty,
        refunded_qty,
        total: 1500,
        surcharge_share: 0,
        taxable: false,
      },
    ],
    payments: [],
    refunds: [],
  } as unknown as OrigInvoice;
}

test("isWeighedRowType: WEIGHT and WEIGHT_PREPACKED only", () => {
  assert.equal(isWeighedRowType("WEIGHT"), true);
  assert.equal(isWeighedRowType("WEIGHT_PREPACKED"), true);
  assert.equal(isWeighedRowType("NORMAL"), false);
  assert.equal(isWeighedRowType("PREPACKED"), false);
});

test("WEIGHT row refunded whole → accepted, full total", () => {
  const [row] = computeRefundRows(original("WEIGHT", 1500), [
    { originalInvoiceRowId: 1, refund_qty: 1500 },
  ]);
  assert.equal(row.refund_qty, 1500);
  assert.equal(row.total, 1500);
});

test("WEIGHT row refunded by partial weight → bad request", () => {
  assert.throws(
    () => computeRefundRows(original("WEIGHT", 1500), [{ originalInvoiceRowId: 1, refund_qty: 500 }]),
    (e: unknown) => e instanceof BadRequestException && /weighed/.test(e.message),
  );
});

test("WEIGHT_PREPACKED row refunded partially → bad request", () => {
  assert.throws(
    () => computeRefundRows(original("WEIGHT_PREPACKED", 820), [{ originalInvoiceRowId: 1, refund_qty: 410 }]),
    BadRequestException,
  );
});

test("WEIGHT row already partly refunded (legacy) → the remainder is not refundable", () => {
  assert.throws(
    () => computeRefundRows(original("WEIGHT", 1500, 500), [{ originalInvoiceRowId: 1, refund_qty: 1000 }]),
    BadRequestException,
  );
});

test("NORMAL row partial qty is still allowed", () => {
  const [row] = computeRefundRows(original("NORMAL", 3000), [{ originalInvoiceRowId: 1, refund_qty: 1000 }]);
  assert.equal(row.total, 500);
});

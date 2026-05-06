import assert from "node:assert/strict";
import test from "node:test";

import { calculateRefundPointsReversed } from "./sale.refund.points";

const originalRows = [
  { id: 1, total: 6000, isPointExcluded: false },
  { id: 2, total: 4000, isPointExcluded: false },
  { id: 3, total: 5000, isPointExcluded: true },
];

test("calculateRefundPointsReversed returns zero when original sale earned no points", () => {
  const result = calculateRefundPointsReversed({
    originalPointsEarned: 0,
    originalRows,
    priorRefundRows: [],
    currentRefundRows: [{ originalInvoiceRowId: 1, total: 6000 }],
  });

  assert.equal(result, 0);
});

test("calculateRefundPointsReversed ignores excluded rows", () => {
  const result = calculateRefundPointsReversed({
    originalPointsEarned: 100,
    originalRows,
    priorRefundRows: [],
    currentRefundRows: [{ originalInvoiceRowId: 3, total: 5000 }],
  });

  assert.equal(result, 0);
});

test("calculateRefundPointsReversed reverses proportional points for a partial eligible refund", () => {
  const result = calculateRefundPointsReversed({
    originalPointsEarned: 100,
    originalRows,
    priorRefundRows: [],
    currentRefundRows: [{ originalInvoiceRowId: 1, total: 3000 }],
  });

  assert.equal(result, 30);
});

test("calculateRefundPointsReversed subtracts points already reversed by prior refunds", () => {
  const result = calculateRefundPointsReversed({
    originalPointsEarned: 100,
    originalRows,
    priorRefundRows: [{ originalInvoiceRowId: 1, total: 3000 }],
    currentRefundRows: [{ originalInvoiceRowId: 2, total: 2000 }],
  });

  assert.equal(result, 20);
});

test("calculateRefundPointsReversed absorbs rounding drift on the final eligible refund", () => {
  const result = calculateRefundPointsReversed({
    originalPointsEarned: 1,
    originalRows: [{ id: 1, total: 3, isPointExcluded: false }],
    priorRefundRows: [{ originalInvoiceRowId: 1, total: 1 }],
    currentRefundRows: [{ originalInvoiceRowId: 1, total: 2 }],
  });

  assert.equal(result, 1);
});

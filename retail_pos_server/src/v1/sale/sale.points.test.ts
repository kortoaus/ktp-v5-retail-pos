import assert from "node:assert/strict";
import test from "node:test";

import { calculateInvoicePoints } from "./sale.points";

const member = { id: "1" };
const rows = [{ total: 10000, isPointExcluded: false }];

test("calculateInvoicePoints excludes voucher payments from other point base", () => {
  const result = calculateInvoicePoints({
    type: "SALE",
    member,
    rows,
    payments: [
      { type: "CASH", amount: 3000 },
      { type: "CREDIT", amount: 2000 },
      { type: "VOUCHER", amount: 5000 },
    ],
    linesTotal: 10000,
    nonCashBill: 7000,
    voucherBill: 5000,
    cashPointRate: 10,
    otherPointRate: 5,
  });

  assert.equal(result, 40);
});

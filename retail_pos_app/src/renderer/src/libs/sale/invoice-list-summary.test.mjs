// npm run test:sale-core — retail-runner T-16 (S-4 §3 / A13): invoice list
// Cash / Credit / Others split (libs/sale/invoice-list-summary.ts).
import assert from "node:assert/strict";
import test from "node:test";

const { tenderSummary } = await import("./invoice-list-summary.ts");

test("CASH → cash, CREDIT → credit, everything else → others (cents)", () => {
  const inv = {
    payments: [
      { type: "CASH", amount: 1000 },
      { type: "CASH", amount: 5 },
      { type: "CREDIT", amount: 2015 },
      { type: "GIFTCARD", amount: 300 },
      { type: "VOUCHER", amount: 500 },
    ],
  };
  assert.deepEqual(tenderSummary(inv), { cash: 1005, credit: 2015, others: 800 });
  assert.deepEqual(tenderSummary({ payments: [] }), { cash: 0, credit: 0, others: 0 });
});

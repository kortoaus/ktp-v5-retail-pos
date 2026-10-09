// npm run test:orders — T-25 (platform; T-14 V-11): the ESC/POS Z-report shows
// Staff Voucher and Customer Voucher as separate lines (totals unchanged) and the
// CRM reconciliation block. Snapshot of the printed text (ascii-replace encoding,
// control sequences stripped, the "Printed:" clock line masked).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The writer class uses TS parameter properties, which node's strip-types
// cannot load — transpile .ts with TypeScript for this test process only
// (same hook as libs/refund/money-contract.test.mjs).
const require = createRequire(import.meta.url);
const ts = require("typescript");
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      const file = fileURLToPath(url);
      const out = ts.transpileModule(readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      return { format: "module", source: out.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { buildShiftSettlementEscposReceipt } = await import("./shift-settlement-escpos.ts");
const { settlementTotals, reconciliationRows } = await import("./shift-settlement-lines.ts");

const SHIFT = {
  id: 12,
  dayStr: "2026-10-09",
  openedUser: "Kim",
  openedAt: "2026-10-08T21:00:00.000Z",
  closedUser: "Lee",
  closedAt: "2026-10-09T07:00:00.000Z",
  salesCount: 4,
  repayCount: 0,
  salesCash: 5000,
  salesCredit: 3000,
  salesUserVoucher: 700,
  salesCustomerVoucher: 1200,
  salesGiftcard: 100,
  salesTax: 900,
  refundsCount: 1,
  refundsCash: 400,
  refundsCredit: 0,
  refundsUserVoucher: 50,
  refundsCustomerVoucher: 300,
  refundsGiftcard: 0,
  refundsTax: 68,
  totalCashIn: 0,
  totalCashOut: 0,
  spendCount: 0,
  spendRetailValue: 0,
  startedCash: 20000,
  endedCashExpected: 24600,
  endedCashActual: 24600,
  customerVoucherReconciliation: {
    redeemed: { count: 2, amount: 1200 },
    refundIssued: { count: 1, amount: 300 },
    voided: 1,
    unresolved: 0,
  },
};

// ESC @ (2 bytes) · ESC a/E/d n (3) · GS ! n (3) · GS V B n (4)
function printedText(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b === 0x1b) i += bytes[i + 1] === 0x40 ? 2 : 3;
    else if (b === 0x1d) i += bytes[i + 1] === 0x56 ? 4 : 3;
    else {
      out += String.fromCharCode(b);
      i += 1;
    }
  }
  return out
    .split("\n")
    .map((line) => (line.includes("Printed:") ? "<printed-at>" : line.trimEnd()));
}

const EXPECTED = [
  "             SHIFT SETTLEMENT",
  "                 Z-REPORT",
  "",
  "------------------------------------------",
  "Shift ID                                12",
  "Day                             2026-10-09",
  "Opened By                              Kim",
  "Opened At              09/10/2026 08:00 AM",
  "Closed By                              Lee",
  "Closed At              09/10/2026 06:00 PM",
  "------------------------------------------",
  "SALES (4)",
  "Cash                                $50.00",
  "Credit                              $30.00",
  "Staff Voucher                        $7.00",
  "Customer Voucher                    $12.00",
  "Gift Card                            $1.00",
  "GST                                  $9.00",
  "Total Sales                        $100.00",
  "------------------------------------------",
  "REFUNDS (1)",
  "Cash                                 $4.00",
  "Credit                               $0.00",
  "Staff Voucher                        $0.50",
  "Customer Voucher                     $3.00",
  "Gift Card                            $0.00",
  "GST                                  $0.68",
  "------------------------------------------",
  "NET TOTAL",
  "Cash                                $46.00",
  "Credit                              $30.00",
  "Staff Voucher                        $6.50",
  "Customer Voucher                     $9.00",
  "Gift Card                            $1.00",
  "GST                                  $8.32",
  "Total                               $92.50",
  "------------------------------------------",
  "CASH IN / OUT",
  "Cash In                              $0.00",
  "Cash Out                             $0.00",
  "------------------------------------------",
  "CRM CUSTOMER VOUCHER",
  "Redeemed (2)                        $12.00",
  "Refund vouchers issued (1)           $3.00",
  "Voided (store, in shift)                 1",
  "Unresolved (store, in shift)             0",
  "------------------------------------------",
  "CASH DRAWER",
  "Started                            $200.00",
  "Expected                           $246.00",
  "Actual                             $246.00",
  "Difference                           $0.00",
  "------------------------------------------",
  "<printed-at>",
  ""
];

test("Z-report snapshot: Staff Voucher and Customer Voucher lines + CRM block", async () => {
  const bytes = await buildShiftSettlementEscposReceipt(SHIFT, { encoding: "ascii-replace" });
  assert.deepEqual(printedText(bytes), EXPECTED);
});

test("no combined 'Voucher' line is left; an older server (no block) prints no CRM section", async () => {
  const { customerVoucherReconciliation: _omit, ...older } = SHIFT;
  const lines = printedText(await buildShiftSettlementEscposReceipt(older, { encoding: "ascii-replace" }));
  assert.equal(lines.some((l) => /^Voucher\b/.test(l)), false);
  assert.equal(lines.some((l) => l.includes("CRM CUSTOMER VOUCHER")), false);
  assert.equal(lines.filter((l) => l.startsWith("Staff Voucher")).length, 3);
  assert.equal(lines.filter((l) => l.startsWith("Customer Voucher")).length, 3);
});

test("totals identity: split voucher lines sum to the former combined line; tender totals unchanged", () => {
  const t = settlementTotals(SHIFT);
  assert.equal(t.salesTenderTotal, 5000 + 3000 + (700 + 1200) + 100);
  assert.equal(t.refundsTenderTotal, 400 + 0 + (50 + 300) + 0);
  assert.equal(t.netStaffVoucher + t.netCustomerVoucher, 700 + 1200 - (50 + 300));
});

test("CRM block rows; none when the server sent no block", () => {
  assert.deepEqual(reconciliationRows(SHIFT.customerVoucherReconciliation), [
    ["Redeemed (2)", "$12.00"],
    ["Refund vouchers issued (1)", "$3.00"],
    ["Voided (store, in shift)", "1"],
    ["Unresolved (store, in shift)", "0"],
  ]);
  assert.equal(reconciliationRows(null), null);
  assert.equal(reconciliationRows(undefined), null);
});

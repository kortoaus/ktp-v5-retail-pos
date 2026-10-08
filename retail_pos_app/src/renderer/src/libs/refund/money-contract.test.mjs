// npm run test:orders — T-24 (audit R-16): the till's money rules against the
// golden vectors the SERVER generated (retail_pos_server/src/v1/sale/fixtures/
// money-contract-vectors.json; server is authoritative). A failure here is a
// till/server mismatch to report — never regenerate the file to make it pass.
//
// Read-only use of Runner copy-set files (store/SalesStore.helper.ts,
// screens/SaleScreen/PaymentModal/usePaymentCal.ts, libs/sale/points.ts):
// this test imports them and changes nothing in them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

// SalesStore.helper.ts imports types without `import type`, which node's
// strip-types cannot load. Transpile .ts with TypeScript (elides type-only
// imports) for this test process only.
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

const { recalculateLine } = await import("../../store/SalesStore.helper.ts");
const { billPortionOf, eftposAmountOf, round5 } = await import(
  "../../screens/SaleScreen/PaymentModal/usePaymentCal.ts"
);
const { calculateSalePoints } = await import("../sale/points.ts");
const { computeInvoice, refundRowComputed, rowProductTax } = await import("./compute.ts");
const { QTY_SCALE } = await import("../constants.ts");

const vectors = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../retail_pos_server/src/v1/sale/fixtures/money-contract-vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("scales agree (qty ×1000)", () => {
  assert.equal(vectors.version, 1);
  assert.equal(QTY_SCALE, vectors.scales.qty);
});

test("line rule (tax / qty scale) — SalesStore.helper.recalculateLine", () => {
  for (const v of vectors.lines) {
    const line = recalculateLine({
      ...v.input,
      unit_price_effective: 0,
      total: 0,
      tax_amount: 0,
      net: 0,
    });
    assert.deepEqual(
      {
        unit_price_effective: line.unit_price_effective,
        total: line.total,
        tax_amount: line.tax_amount,
        net: line.net,
      },
      v.expected,
      v.name,
    );
  }
});

test("CREDIT bill / surcharge split — usePaymentCal.billPortionOf", () => {
  for (const v of vectors.credit) {
    const bill = billPortionOf({ key: "k", tender: "CREDIT", amount: v.input.amount }, v.input.rate);
    assert.equal(bill, v.expected.bill, v.name);
    assert.equal(v.input.amount - bill, v.expected.surcharge, v.name);
    // keyed amounts in the vectors are reachable from their bill
    assert.equal(eftposAmountOf(bill, v.input.rate), v.input.amount, `${v.name} round trip`);
  }
});

test("cash 5¢ rounding — usePaymentCal.round5", () => {
  for (const v of vectors.cashRounding) {
    const rounding = v.input.cashOnly ? round5(v.input.subtotal) - v.input.subtotal : 0;
    assert.equal(rounding, v.expected.rounding, v.name);
  }
});

test("refund allocation + totals — libs/refund/compute", () => {
  for (const v of vectors.refunds) {
    const refunds = v.input.priorRefunds.map((child) => ({ type: "REFUND", rows: child.rows, payments: [] }));
    const invoice = { rows: v.input.rows, refunds, payments: [] };
    const selections = Object.fromEntries(v.input.request.map((r) => [r.originalInvoiceRowId, r.refund_qty]));

    for (const want of v.expected.rows) {
      const row = v.input.rows.find((r) => r.id === want.originalInvoiceRowId);
      const qty = selections[row.id];
      const c = refundRowComputed(row, qty, refunds);
      const tax = rowProductTax(row, qty, refunds);
      assert.deepEqual(
        { total: c.product, surcharge_share: c.surcharge, tax_amount: tax, net: c.product - tax },
        { total: want.total, surcharge_share: want.surcharge_share, tax_amount: want.tax_amount, net: want.net },
        `${v.name} row ${row.id}`,
      );
    }

    const calc = computeInvoice(invoice, selections, { allCashMode: v.input.cashOnly });
    const e = v.expected;
    assert.deepEqual(
      {
        linesTotal: calc.linesTotal,
        creditSurchargeAmount: calc.creditSurchargeAmount,
        lineTax: calc.lineTax,
        surchargeTax: calc.surchargeTax,
        rounding: calc.rounding,
        total: calc.total,
      },
      {
        linesTotal: e.linesTotal,
        creditSurchargeAmount: e.creditSurchargeAmount,
        lineTax: e.lineTax,
        surchargeTax: e.surchargeTax,
        rounding: e.rounding,
        total: e.total,
      },
      v.name,
    );
    // pointsReversed is server-only (the till shows the server's number).
  }
});

test("points earned — libs/sale/points with the PaymentModal input mapping", () => {
  for (const v of vectors.points) {
    const { payments, creditSurchargeRate: rate } = v.input;
    const cashApplied = payments.filter((p) => p.type === "CASH").reduce((s, p) => s + p.amount, 0);
    const nonCashBill = payments
      .filter((p) => p.type !== "CASH")
      .reduce((s, p) => s + billPortionOf({ key: "k", tender: p.type, amount: p.amount }, rate), 0);
    const voucherBill = payments.filter((p) => p.type === "VOUCHER").reduce((s, p) => s + p.amount, 0);
    const result = calculateSalePoints({
      lines: v.input.rows,
      linesTotal: v.input.linesTotal,
      cashApplied,
      nonCashBill,
      voucherBill,
      hasMember: v.input.hasMember,
      cashPointRate: v.input.cashPointRate,
      otherPointRate: v.input.otherPointRate,
    });
    assert.equal(result.pointsEarned, v.expected.pointsEarned, v.name);
  }
});

// surchargeShares: the server allocates surcharge_share per row; the till
// never computes it (it sends creditSurchargeAmount only) — server-only family.

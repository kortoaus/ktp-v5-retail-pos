import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  allocateSurchargeShares,
  expectedRowAmounts,
  salePayloadPoints,
  validateAmounts,
} from "./sale.create.service";
import { billPortionOfCredit } from "./sale.repay.service";
import {
  aggregateRefund,
  computeRefundRounding,
  computeRefundRows,
  prepareRefund,
  type OrigInvoice,
} from "./sale.refund.service";
import type {
  MoneyContractVectors,
  MoneyVectorCashRounding,
  MoneyVectorCredit,
  MoneyVectorLine,
  MoneyVectorPoints,
  MoneyVectorRefund,
  MoneyVectorShares,
  SaleCreatePayload,
} from "./sale.types";

// T-24 (audit R-16) — golden money-contract vectors. The INPUTS live here; the
// EXPECTED values are whatever the server's own functions answer (the server
// is authoritative). `UPDATE_MONEY_VECTORS=1 npm test` rewrites the fixture;
// a plain run fails when the server's answer drifts from the committed file.
// The till's renderer test (retail_pos_app/src/renderer/src/libs/refund/
// money-contract.test.mjs) checks its own functions against the same file.
//
// D-16 / rule retail-pos/refund-weighed-rows-whole-only: weighed rows appear
// only as whole-row refunds; partial refunds use whole-unit (×1000) quantities.

const FIXTURE = join(__dirname, "fixtures", "money-contract-vectors.json");

// ── inputs ────────────────────────────────────────────────────────

const LINE_INPUTS: Array<[string, MoneyVectorLine["input"]]> = [
  ["1 ea taxable", { unit_price_original: 1290, unit_price_discounted: null, unit_price_adjusted: null, qty: 1000, taxable: true }],
  ["3 ea non-taxable", { unit_price_original: 333, unit_price_discounted: null, unit_price_adjusted: null, qty: 3000, taxable: false }],
  ["0.745 kg taxable (rounds up)", { unit_price_original: 1299, unit_price_discounted: null, unit_price_adjusted: null, qty: 745, taxable: true }],
  ["1.005 kg non-taxable", { unit_price_original: 99, unit_price_discounted: null, unit_price_adjusted: null, qty: 1005, taxable: false }],
  ["half-cent .5 rounds up", { unit_price_original: 1299, unit_price_discounted: null, unit_price_adjusted: null, qty: 500, taxable: false }],
  ["member discount wins over original", { unit_price_original: 1000, unit_price_discounted: 900, unit_price_adjusted: null, qty: 2000, taxable: true }],
  ["price override wins over discount", { unit_price_original: 1000, unit_price_discounted: 900, unit_price_adjusted: 850, qty: 1000, taxable: true }],
  ["tax rounds to 0 (total 5)", { unit_price_original: 5, unit_price_discounted: null, unit_price_adjusted: null, qty: 1000, taxable: true }],
  ["tax rounds to 1 (total 6)", { unit_price_original: 6, unit_price_discounted: null, unit_price_adjusted: null, qty: 1000, taxable: true }],
  ["zero-price line", { unit_price_original: 0, unit_price_discounted: null, unit_price_adjusted: null, qty: 1000, taxable: true }],
  ["12 ea taxable", { unit_price_original: 2499, unit_price_discounted: null, unit_price_adjusted: null, qty: 12000, taxable: true }],
];

const CREDIT_INPUTS: Array<[string, MoneyVectorCredit["input"]]> = [
  ["$10.15 at 1.5%", { amount: 1015, rate: 15 }],
  ["$12.34 at 1.5%", { amount: 1234, rate: 15 }],
  ["$100.00 at 1.5%", { amount: 10000, rate: 15 }],
  ["$0.01 at 1.5%", { amount: 1, rate: 15 }],
  ["$57.99 at 1.0%", { amount: 5799, rate: 10 }],
  ["$57.99 at 0% (no surcharge)", { amount: 5799, rate: 0 }],
  ["$1,234.56 at 2.2%", { amount: 123456, rate: 22 }],
];

const SHARE_INPUTS: Array<[string, MoneyVectorShares["input"]]> = [
  ["even split", { creditSurcharge: 30, rowTotals: [1000, 1000], linesTotal: 2000 }],
  ["drift to last row", { creditSurcharge: 10, rowTotals: [333, 333, 334], linesTotal: 1000 }],
  ["no surcharge", { creditSurcharge: 0, rowTotals: [500, 700], linesTotal: 1200 }],
  ["single row", { creditSurcharge: 19, rowTotals: [1290], linesTotal: 1290 }],
];

const ROUNDING_INPUTS: Array<[string, MoneyVectorCashRounding["input"]]> = [
  ...[1000, 1001, 1002, 1003, 1004, 1006, 1007, 1008, 1009, 7342, 7343, 7345, 0].map(
    (subtotal): [string, MoneyVectorCashRounding["input"]] => [
      `cash-only ${subtotal}`,
      { subtotal, cashOnly: true },
    ],
  ),
  ["mixed tender — no rounding", { subtotal: 1003, cashOnly: false }],
];

const ROWS_A: MoneyVectorRefund["input"]["rows"] = [
  // 3 ea taxable, surcharge share 6
  { id: 1, qty: 3000, refunded_qty: 0, total: 1000, surcharge_share: 6, taxable: true, isPointExcluded: false },
  // weighed row 0.745 kg — whole-row only (D-16)
  { id: 2, qty: 745, refunded_qty: 0, total: 968, surcharge_share: 5, taxable: false, isPointExcluded: false },
  // point-excluded ea row
  { id: 3, qty: 1000, refunded_qty: 0, total: 499, surcharge_share: 3, taxable: true, isPointExcluded: true },
];

const REFUND_INPUTS: Array<[string, MoneyVectorRefund["input"]]> = [
  [
    "1 of 3 ea (proportional), card",
    { rows: ROWS_A, priorRefunds: [], request: [{ originalInvoiceRowId: 1, refund_qty: 1000 }], cashOnly: false, originalPointsEarned: 25 },
  ],
  [
    "weighed row whole, cash-only rounding",
    { rows: ROWS_A, priorRefunds: [], request: [{ originalInvoiceRowId: 2, refund_qty: 745 }], cashOnly: true, originalPointsEarned: 25 },
  ],
  [
    "last 2 of 3 ea after a prior 1 — drift absorbed",
    {
      rows: ROWS_A.map((r) => (r.id === 1 ? { ...r, refunded_qty: 1000 } : r)),
      priorRefunds: [{ rows: [{ originalInvoiceRowId: 1, total: 333, surcharge_share: 2, qty: 1000 }] }],
      request: [{ originalInvoiceRowId: 1, refund_qty: 2000 }],
      cashOnly: false,
      originalPointsEarned: 25,
    },
  ],
  [
    "everything at once, cash-only",
    {
      rows: ROWS_A,
      priorRefunds: [],
      request: [
        { originalInvoiceRowId: 1, refund_qty: 3000 },
        { originalInvoiceRowId: 2, refund_qty: 745 },
        { originalInvoiceRowId: 3, refund_qty: 1000 },
      ],
      cashOnly: true,
      originalPointsEarned: 25,
    },
  ],
  [
    "point-excluded row only — no points reversed",
    { rows: ROWS_A, priorRefunds: [], request: [{ originalInvoiceRowId: 3, refund_qty: 1000 }], cashOnly: false, originalPointsEarned: 25 },
  ],
];

const POINT_ROWS = [
  { total: 1000, isPointExcluded: false },
  { total: 968, isPointExcluded: false },
  { total: 499, isPointExcluded: true },
];
const POINTS_LINES_TOTAL = 2467;

const POINTS_INPUTS: Array<[string, MoneyVectorPoints["input"]]> = [
  ["cash only", { rows: POINT_ROWS, linesTotal: POINTS_LINES_TOTAL, payments: [{ type: "CASH", amount: 2465 }], creditSurchargeRate: 15, hasMember: true, cashPointRate: 20, otherPointRate: 10 }],
  ["card only (surcharge in the keyed amount)", { rows: POINT_ROWS, linesTotal: POINTS_LINES_TOTAL, payments: [{ type: "CREDIT", amount: 2504 }], creditSurchargeRate: 15, hasMember: true, cashPointRate: 20, otherPointRate: 10 }],
  ["cash + card", { rows: POINT_ROWS, linesTotal: POINTS_LINES_TOTAL, payments: [{ type: "CREDIT", amount: 1015 }, { type: "CASH", amount: 1467 }], creditSurchargeRate: 15, hasMember: true, cashPointRate: 20, otherPointRate: 10 }],
  ["voucher + cash", { rows: POINT_ROWS, linesTotal: POINTS_LINES_TOTAL, payments: [{ type: "VOUCHER", amount: 2000 }, { type: "CASH", amount: 467 }], creditSurchargeRate: 15, hasMember: true, cashPointRate: 20, otherPointRate: 10 }],
  ["no member", { rows: POINT_ROWS, linesTotal: POINTS_LINES_TOTAL, payments: [{ type: "CASH", amount: 2465 }], creditSurchargeRate: 15, hasMember: false, cashPointRate: 20, otherPointRate: 10 }],
];

// ── the server's answers ──────────────────────────────────────────

function refundExpected(input: MoneyVectorRefund["input"]): MoneyVectorRefund["expected"] {
  const tenderType = input.cashOnly ? "CASH" : "CREDIT";
  const orig = {
    id: 100,
    type: "SALE",
    memberId: "m-1",
    pointsEarned: input.originalPointsEarned,
    rows: input.rows.map((r) => ({ ...r })),
    payments: [{ type: tenderType, amount: 1_000_000, entityType: null, entityId: null }],
    refunds: input.priorRefunds.map((child, i) => ({
      id: 200 + i,
      type: "REFUND",
      rows: child.rows.map((r) => ({ ...r })),
      payments: [],
    })),
  } as unknown as OrigInvoice;

  // Rounding depends only on the tender mix; the refund is then paid in full
  // with that one tender so prepareRefund's payment checks pass.
  const probe = aggregateRefund(computeRefundRows(orig, input.request), [
    { type: tenderType, amount: 1 },
  ]).total;
  const { computed, aggregates, pointsReversed } = prepareRefund(orig, {
    originalInvoiceId: 100,
    rows: input.request,
    payments: [{ type: tenderType, amount: probe }],
  });
  return {
    rows: computed.map((c) => ({
      originalInvoiceRowId: c.origRow.id,
      total: c.total,
      surcharge_share: c.surcharge_share,
      tax_amount: c.tax_amount,
      net: c.net,
    })),
    linesTotal: aggregates.linesTotal,
    creditSurchargeAmount: aggregates.creditSurchargeAmount,
    lineTax: aggregates.lineTax,
    surchargeTax: aggregates.surchargeTax,
    rounding: aggregates.rounding,
    total: aggregates.total,
    pointsReversed,
  };
}

function computeVectors(): MoneyContractVectors {
  return {
    version: 1,
    note:
      "Generated from retail_pos_server's own functions (server is authoritative). " +
      "Regenerate with UPDATE_MONEY_VECTORS=1 npm test in retail_pos_server; never hand-edit. " +
      "Money in cents, qty x1000, rates per-1000.",
    scales: { money: 100, qty: 1000, pct: 1000 },
    lines: LINE_INPUTS.map(([name, input]) => ({ name, input, expected: expectedRowAmounts(input) })),
    credit: CREDIT_INPUTS.map(([name, input]) => {
      const bill = billPortionOfCredit(input.amount, input.rate);
      const surcharge = input.amount - bill;
      return { name, input, expected: { bill, surcharge, surchargeTax: Math.round(surcharge / 11) } };
    }),
    surchargeShares: SHARE_INPUTS.map(([name, input]) => ({
      name,
      input,
      expected: {
        shares: allocateSurchargeShares(
          input.creditSurcharge,
          input.rowTotals.map((total) => ({ total }) as SaleCreatePayload["rows"][number]),
          input.linesTotal,
        ),
      },
    })),
    cashRounding: ROUNDING_INPUTS.map(([name, input]) => ({
      name,
      input,
      expected: {
        rounding: computeRefundRounding(
          input.subtotal,
          input.cashOnly
            ? [{ type: "CASH", amount: 1 }]
            : [{ type: "CASH", amount: 1 }, { type: "CREDIT", amount: 1 }],
        ),
      },
    })),
    refunds: REFUND_INPUTS.map(([name, input]) => ({ name, input, expected: refundExpected(input) })),
    points: POINTS_INPUTS.map(([name, input]) => ({
      name,
      input,
      expected: {
        pointsEarned: salePayloadPoints(
          {
            type: "SALE",
            member: input.hasMember ? { id: "m-1", name: "Lee", level: 0, phoneLast4: null } : null,
            rows: input.rows as SaleCreatePayload["rows"],
            payments: input.payments,
            linesTotal: input.linesTotal,
          },
          { cash_point_rate: input.cashPointRate, other_point_rate: input.otherPointRate },
        ),
      },
    })),
  };
}

test("money-contract vectors match the server's current answers", () => {
  const computed = computeVectors();
  if (process.env.UPDATE_MONEY_VECTORS === "1") {
    writeFileSync(FIXTURE, JSON.stringify(computed, null, 2) + "\n");
  }
  const committed = JSON.parse(readFileSync(FIXTURE, "utf8")) as MoneyContractVectors;
  assert.deepEqual(committed, computed);
});

test("validateAmounts accepts every line vector and rejects a 1¢ total drift", () => {
  const { lines } = computeVectors();
  for (const v of lines) {
    const row = {
      index: 0,
      type: "NORMAL" as const,
      itemId: 1,
      name_en: v.name,
      name_ko: v.name,
      barcode: "1",
      uom: "ea",
      isPointExcluded: false,
      measured_weight: null,
      adjustments: [],
      ppMarkdownType: null,
      ppMarkdownAmount: null,
      ...v.input,
      ...v.expected,
    };
    const payload = (r: typeof row): SaleCreatePayload => ({
      type: "SALE",
      member: null,
      linesTotal: r.total,
      rounding: 0,
      creditSurchargeAmount: 0,
      lineTax: r.tax_amount,
      surchargeTax: 0,
      total: r.total,
      cashChange: 0,
      rows: [r],
      payments: [{ type: "CASH", amount: r.total }],
    });
    assert.doesNotThrow(() => validateAmounts(payload(row)), v.name);
    const drift = { ...row, total: row.total + 1, net: row.net + 1 };
    assert.throws(() => validateAmounts(payload(drift)), /total mismatch/, v.name);
  }
});

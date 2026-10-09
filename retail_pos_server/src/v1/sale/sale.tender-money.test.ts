import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { BadRequestException } from "../../libs/exceptions";
import { validateAmounts } from "./sale.create.service";
import { assertSaleTenderAmounts, deriveSaleTenderAmounts } from "./sale.tender-money";
import type { MoneyContractVectors, PaymentPayload, SaleCreatePayload } from "./sale.types";

// F-24 (T-26): SALE rounding / creditSurchargeAmount are re-derived on the server
// from the tenders and the store rate. Inputs come from the T-24 golden vectors
// (fixtures/money-contract-vectors.json), which the till's renderer test also reads.

const vectors = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "money-contract-vectors.json"), "utf8"),
) as MoneyContractVectors;

function sale(linesTotal: number, payments: PaymentPayload[], over: Partial<SaleCreatePayload> = {}) {
  return {
    linesTotal,
    cashChange: 0,
    payments,
    rounding: 0,
    creditSurchargeAmount: 0,
    ...over,
  };
}

function rejects(p: Parameters<typeof assertSaleTenderAmounts>[0], rate: number, msg: RegExp) {
  assert.throws(
    () => assertSaleTenderAmounts(p, rate),
    (e: unknown) => e instanceof BadRequestException && e.statusCode === 400 && msg.test(e.message),
  );
}

test("credit vectors: card-only surcharge is derived from the keyed amount and the store rate", () => {
  assert.ok(vectors.credit.length > 0);
  for (const v of vectors.credit) {
    const p = sale(v.expected.bill, [{ type: "CREDIT", amount: v.input.amount }]);
    assert.deepEqual(deriveSaleTenderAmounts(p, v.input.rate), {
      rounding: 0,
      creditSurchargeAmount: v.expected.surcharge,
    }, v.name);
    assert.doesNotThrow(
      () => assertSaleTenderAmounts({ ...p, creditSurchargeAmount: v.expected.surcharge }, v.input.rate),
      v.name,
    );
    rejects({ ...p, creditSurchargeAmount: v.expected.surcharge + 1 }, v.input.rate, /creditSurchargeAmount mismatch/);
  }
});

test("cash-rounding vectors: cash-only sales round to 5¢, a card in the mix never rounds", () => {
  assert.ok(vectors.cashRounding.length > 0);
  for (const v of vectors.cashRounding) {
    const { subtotal, cashOnly } = v.input;
    const payments: PaymentPayload[] = cashOnly
      ? [{ type: "CASH", amount: subtotal + v.expected.rounding }]
      : [{ type: "CASH", amount: subtotal - 1000 }, { type: "CREDIT", amount: 1015 }];
    const p = sale(subtotal, payments, { creditSurchargeAmount: cashOnly ? 0 : 15 });
    assert.equal(deriveSaleTenderAmounts(p, 15).rounding, v.expected.rounding, v.name);
    assert.doesNotThrow(() => assertSaleTenderAmounts({ ...p, rounding: v.expected.rounding }, 15), v.name);
  }
});

test("till rule cases the vectors do not cover: voucher + cash rounds the cash part, a $0 staged cash slot rounds, short cash does not", () => {
  // linesTotal 1003, voucher 500, cash 505 → cash target 503 rounds to 505 (+2)
  assert.equal(deriveSaleTenderAmounts(sale(1003, [{ type: "VOUCHER", amount: 500 }, { type: "CASH", amount: 505 }]), 15).rounding, 2);
  // voucher 1000 of 1002 with an empty cash slot at the till → −2, payments are the voucher alone
  assert.equal(deriveSaleTenderAmounts(sale(1002, [{ type: "VOUCHER", amount: 1000 }]), 15).rounding, -2);
  // change given: 1001 paid with 2000 cash → applied 1000 + change 1000
  assert.equal(deriveSaleTenderAmounts(sale(1001, [{ type: "CASH", amount: 1000 }], { cashChange: 1000 }), 15).rounding, -1);
  // exact cash 1003 does not cover the rounded 1005 → no rounding
  assert.equal(deriveSaleTenderAmounts(sale(1003, [{ type: "CASH", amount: 1003 }]), 15).rounding, 0);
  // gift card is an exact tender → no rounding
  assert.equal(deriveSaleTenderAmounts(sale(1003, [{ type: "GIFTCARD", amount: 3 }, { type: "CASH", amount: 1000 }]), 15).rounding, 0);
});

test("a crafted till value is rejected: rounding on a card sale, wrong rounding, inflated surcharge", () => {
  rejects(sale(1003, [{ type: "CREDIT", amount: 1020 }], { rounding: 2, creditSurchargeAmount: 15 }), 15, /rounding mismatch: got 2, expected 0/);
  rejects(sale(1003, [{ type: "CASH", amount: 1000 }], { rounding: -3 }), 15, /rounding mismatch: got -3, expected 0/);
  // F-24 scenario: sums still balance (total = linesTotal + surcharge = Σ payments) but the surcharge is not the store rate's
  const crafted: SaleCreatePayload = {
    type: "SALE",
    member: null,
    linesTotal: 1000,
    rounding: 0,
    creditSurchargeAmount: 100,
    lineTax: 0,
    surchargeTax: 9,
    total: 1100,
    cashChange: 0,
    rows: [{
      index: 0, type: "NORMAL", itemId: 1, name_en: "Item", name_ko: "아이템", barcode: "1", uom: "ea",
      taxable: false, isPointExcluded: false, unit_price_original: 1000, unit_price_discounted: null,
      unit_price_adjusted: null, unit_price_effective: 1000, qty: 1000, measured_weight: null,
      total: 1000, tax_amount: 0, net: 1000, adjustments: [], ppMarkdownType: null, ppMarkdownAmount: null,
    }],
    payments: [{ type: "CREDIT", amount: 1100 }],
  };
  assert.doesNotThrow(() => validateAmounts(crafted)); // the invariants alone accept it
  rejects(crafted, 15, /creditSurchargeAmount mismatch: got 100, expected 16/);
});

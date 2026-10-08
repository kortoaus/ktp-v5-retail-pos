import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "../../libs/exceptions";
import { validateAmounts } from "./sale.create.service";
import type { SaleCreatePayload, SaleRowPayload } from "./sale.types";

// R-9 — tender / row shape and sign guard (pure; no DB).

function row(over: Partial<SaleRowPayload> = {}): SaleRowPayload {
  return {
    index: 0,
    type: "NORMAL",
    itemId: 1,
    name_en: "Item",
    name_ko: "아이템",
    barcode: "1",
    uom: "ea",
    taxable: false,
    isPointExcluded: false,
    unit_price_original: 1000,
    unit_price_discounted: null,
    unit_price_adjusted: null,
    unit_price_effective: 1000,
    qty: 1000,
    measured_weight: null,
    total: 1000,
    tax_amount: 0,
    net: 1000,
    adjustments: [],
    ppMarkdownType: null,
    ppMarkdownAmount: null,
    ...over,
  };
}

function sale(over: Partial<SaleCreatePayload> = {}): SaleCreatePayload {
  return {
    type: "SALE",
    member: null,
    linesTotal: 1000,
    rounding: 0,
    creditSurchargeAmount: 0,
    lineTax: 0,
    surchargeTax: 0,
    total: 1000,
    cashChange: 0,
    rows: [row()],
    payments: [{ type: "CASH", amount: 1000 }],
    ...over,
  };
}

function rejects(p: SaleCreatePayload, msg?: RegExp) {
  assert.throws(
    () => validateAmounts(p),
    (e: unknown) => {
      assert.ok(e instanceof BadRequestException);
      assert.equal(e.statusCode, 400);
      if (msg) assert.match(e.message, msg);
      return true;
    },
  );
}

test("baseline sale passes", () => {
  validateAmounts(sale());
  validateAmounts(
    sale({
      payments: [
        { type: "CASH", amount: 300 },
        { type: "VOUCHER", amount: 700, entityType: "user-voucher", entityId: 5 },
      ],
    }),
  );
  // signed cash rounding is allowed
  validateAmounts(
    sale({
      rows: [row({ unit_price_original: 1002, unit_price_effective: 1002, total: 1002, net: 1002 })],
      linesTotal: 1002,
      rounding: -2,
      total: 1000,
    }),
  );
});

test("audit case: 1000 sale paid CASH 2000 + user-voucher -1000 → 400", () => {
  rejects(
    sale({
      payments: [
        { type: "CASH", amount: 2000 },
        { type: "VOUCHER", amount: -1000, entityType: "user-voucher", entityId: 5 },
      ],
    }),
    /payment\[1\] amount must be >= 0/,
  );
});

test("non-integer / non-number payment amounts → 400", () => {
  rejects(sale({ payments: [{ type: "CASH", amount: 999.5 }, { type: "CASH", amount: 0.5 }] }));
  rejects(sale({ payments: [{ type: "CASH", amount: "1000" as unknown as number }] }));
  rejects(sale({ payments: [{ type: "CASH", amount: Number.MAX_SAFE_INTEGER + 1 }] }));
});

test("unknown tender type / voucher entityType → 400", () => {
  rejects(sale({ payments: [{ type: "BITCOIN" as "CASH", amount: 1000 }] }), /type is not supported/);
  rejects(
    sale({ payments: [{ type: "VOUCHER", amount: 1000, entityId: 5 }] }),
    /entityType is not supported/,
  );
});

test("row qty must be a positive integer", () => {
  rejects(sale({ rows: [row({ qty: 0, total: 0, net: 0 })], linesTotal: 0, total: 0, payments: [{ type: "CASH", amount: 0 }] }), /qty must be >= 1/);
  rejects(sale({ rows: [row({ qty: -1000, total: -1000, net: -1000 })], linesTotal: -1000, total: -1000, payments: [{ type: "CASH", amount: -1000 }] }));
  rejects(sale({ rows: [row({ qty: 1000.5 })] }), /qty must be an integer/);
});

test("row prices must be integers ≥ 0", () => {
  rejects(
    sale({
      rows: [row({ unit_price_adjusted: -500, unit_price_effective: -500, total: -500, net: -500 })],
      linesTotal: -500,
      total: -500,
      payments: [{ type: "CASH", amount: -500 }],
    }),
  );
  rejects(sale({ rows: [row({ unit_price_original: -1 })] }), /unit_price_original must be >= 0/);
  rejects(sale({ rows: [row({ unit_price_discounted: 10.5 })] }), /unit_price_discounted must be an integer/);
  rejects(sale({ rows: [row({ unit_price_effective: Number.NaN })] }));
});

test("header amounts: negative total / surcharge / change → 400", () => {
  rejects(sale({ cashChange: -1 }), /cashChange/);
  rejects(sale({ creditSurchargeAmount: -10 }), /creditSurchargeAmount/);
  rejects(sale({ rounding: 0.5 }), /rounding must be an integer/);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "../../generated/prisma/client";
import { aggregateShift } from "./shift.service";
import {
  customerVoucherShiftReconciliation,
  summarizeShiftLedger,
  type ShiftSummaryDb,
} from "../customer-voucher/customer-voucher.shift-summary";

// T-25 (platform; T-14 V-11) — Staff Voucher and Customer Voucher stay separate
// in the shift aggregate (their sum is the old combined Voucher), and the CRM
// reconciliation block counts the T-15 ledger for the shift.

function fakeAggregateClient() {
  const salePayments = [
    { type: "CASH", entityType: null, _sum: { amount: 5000 } },
    { type: "CREDIT", entityType: null, _sum: { amount: 3000 } },
    { type: "VOUCHER", entityType: "user-voucher", _sum: { amount: 700 } },
    { type: "VOUCHER", entityType: "customer-voucher", _sum: { amount: 1200 } },
    { type: "GIFTCARD", entityType: null, _sum: { amount: 100 } },
  ];
  const refundPayments = [
    { type: "CASH", entityType: null, _sum: { amount: 400 } },
    { type: "VOUCHER", entityType: "user-voucher", _sum: { amount: 50 } },
    { type: "VOUCHER", entityType: "customer-voucher", _sum: { amount: 300 } },
  ];
  return {
    saleInvoice: {
      groupBy: async () => [
        { type: "SALE", _sum: { linesTotal: 10000, rounding: 0, creditSurchargeAmount: 0, lineTax: 0, surchargeTax: 0 }, _count: { _all: 4 } },
        { type: "REFUND", _sum: { linesTotal: 750, rounding: 0, creditSurchargeAmount: 0, lineTax: 0, surchargeTax: 0 }, _count: { _all: 1 } },
      ],
      count: async () => 0,
    },
    saleInvoicePayment: {
      groupBy: async (args: { where: { invoice: { type: string } } }) =>
        args.where.invoice.type === "SALE" ? salePayments : refundPayments,
    },
    cashInOut: { groupBy: async () => [] },
    saleInvoiceRow: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;
}

test("shift aggregate keeps Staff Voucher and Customer Voucher apart; totals unchanged in sum", async () => {
  const a = await aggregateShift(3, fakeAggregateClient());
  assert.equal(a.salesUserVoucher, 700);
  assert.equal(a.salesCustomerVoucher, 1200);
  assert.equal(a.refundsUserVoucher, 50);
  assert.equal(a.refundsCustomerVoucher, 300);
  // identity: the split lines add up to the former combined Voucher line, and
  // the tender total is the same with either presentation
  assert.equal(a.salesUserVoucher + a.salesCustomerVoucher, 1900);
  const salesTender = a.salesCash + a.salesCredit + a.salesUserVoucher + a.salesCustomerVoucher + a.salesGiftcard;
  assert.equal(salesTender, 5000 + 3000 + 1900 + 100);
  const refundsTender = a.refundsCash + a.refundsCredit + a.refundsUserVoucher + a.refundsCustomerVoucher + a.refundsGiftcard;
  assert.equal(refundsTender, 400 + 350);
});

test("reconciliation summary: linked redeems / refund issues of the shift, voided and open rows of its window", () => {
  const linked = [
    { kind: "REDEEM", status: "LINKED", amount: 400, invoiceId: 1 },
    { kind: "REDEEM", status: "LINKED", amount: 800, invoiceId: 2 },
    { kind: "REFUND_ISSUE", status: "LINKED", amount: 300, invoiceId: 3 },
  ];
  const windowRows = [
    { kind: "REDEEM", status: "VOIDED", amount: 100, invoiceId: null },
    { kind: "REDEEM", status: "UNRESOLVED", amount: 100, invoiceId: null },
    { kind: "REFUND_ISSUE", status: "INTENT", amount: 100, invoiceId: null },
    { kind: "REDEEM", status: "CONFIRMED", amount: 100, invoiceId: null },
    { kind: "REDEEM", status: "CONFIRMED", amount: 100, invoiceId: 9 }, // about to link: not open
    { kind: "VOID_REDEEM", status: "UNRESOLVED", amount: 100, invoiceId: null }, // audit row: not counted
  ];
  assert.deepEqual(summarizeShiftLedger(linked, windowRows), {
    redeemed: { count: 2, amount: 1200 },
    refundIssued: { count: 1, amount: 300 },
    voided: 1,
    unresolved: 3,
  });
});

test("reconciliation summary never fails the settlement: unreadable ledger → null", async () => {
  const broken: ShiftSummaryDb = {
    saleInvoice: { findMany: async () => { throw new Error("db down"); } },
    customerVoucherOperation: { findMany: async () => [] },
  };
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await customerVoucherShiftReconciliation({ id: 3, openedAt: new Date(), closedAt: null }, broken), null);
  } finally {
    console.error = original;
  }
});

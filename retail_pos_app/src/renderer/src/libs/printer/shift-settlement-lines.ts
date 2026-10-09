// T-25 (platform; T-14 V-11) — what the shift settlement shows for vouchers,
// shared by the close screen, the ESC/POS Z-report and the raster Z-report.
//
//  - Staff Voucher (user vouchers, staff allowance) and Customer Voucher (CRM)
//    are separate lines. Their sum is the former combined "Voucher" line; every
//    total is unchanged.
//  - A short CRM reconciliation block from the store server's T-15 ledger:
//    redeemed / refund vouchers issued (this shift's invoices), voided and
//    unresolved (store-wide, during the shift).

import type { TerminalShift } from "../../types/models";

export interface CustomerVoucherShiftReconciliation {
  redeemed: { count: number; amount: number };
  refundIssued: { count: number; amount: number };
  voided: number;
  unresolved: number;
}

// The shift as the server answers GET /api/shift/:id (T-25 adds the block;
// older servers omit it).
export type ShiftSettlement = TerminalShift & {
  customerVoucherReconciliation?: CustomerVoucherShiftReconciliation | null;
};

export interface SettlementTenders {
  salesCash: number;
  salesCredit: number;
  salesUserVoucher: number;
  salesCustomerVoucher: number;
  salesGiftcard: number;
  refundsCash: number;
  refundsCredit: number;
  refundsUserVoucher: number;
  refundsCustomerVoucher: number;
  refundsGiftcard: number;
}

export const STAFF_VOUCHER_LABEL = "Staff Voucher";
export const CUSTOMER_VOUCHER_LABEL = "Customer Voucher";

export function settlementTotals(s: SettlementTenders) {
  const salesTenderTotal =
    s.salesCash + s.salesCredit + s.salesUserVoucher + s.salesCustomerVoucher + s.salesGiftcard;
  const refundsTenderTotal =
    s.refundsCash +
    s.refundsCredit +
    s.refundsUserVoucher +
    s.refundsCustomerVoucher +
    s.refundsGiftcard;
  return {
    salesTenderTotal,
    refundsTenderTotal,
    netStaffVoucher: s.salesUserVoucher - s.refundsUserVoucher,
    netCustomerVoucher: s.salesCustomerVoucher - s.refundsCustomerVoucher,
  };
}

const money = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

// [label, value] rows of the CRM block; null when the server sent none.
export function reconciliationRows(
  rec: CustomerVoucherShiftReconciliation | null | undefined,
): [string, string][] | null {
  if (!rec) return null;
  return [
    [`Redeemed (${rec.redeemed.count})`, money(rec.redeemed.amount)],
    [`Refund vouchers issued (${rec.refundIssued.count})`, money(rec.refundIssued.amount)],
    ["Voided (store, in shift)", String(rec.voided)],
    ["Unresolved (store, in shift)", String(rec.unresolved)],
  ];
}

export const RECONCILIATION_HEADER = "CRM CUSTOMER VOUCHER";

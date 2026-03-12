import { Prisma } from "../../generated/prisma/client";

export function dollarToCent(v: Prisma.Decimal | number): number {
  return Math.round(Number(v) * 100);
}

// 1 => 1000, 1.2 => 1200, 1.23 => 1230
export function qtyToThousand(v: Prisma.Decimal | number): number {
  return Math.round(Number(v) * 1000);
}

export function convertInvoiceToCents(invoice: any) {
  const rows = invoice.rows?.map((row: any) => ({
    id: row.id,
    invoiceId: row.invoiceId,
    type: row.type,
    itemId: row.itemId,
    name_en: row.name_en,
    name_ko: row.name_ko,
    taxable: row.taxable,
    uom: row.uom,
    barcode: row.barcode,
    index: row.index,
    barcodePrice:
      row.barcodePrice != null ? dollarToCent(row.barcodePrice) : null,
    unit_price_original: dollarToCent(row.unit_price_original),
    unit_price_discounted:
      row.unit_price_discounted != null
        ? dollarToCent(row.unit_price_discounted)
        : null,
    unit_price_adjusted:
      row.unit_price_adjusted != null
        ? dollarToCent(row.unit_price_adjusted)
        : null,
    unit_price_effective: dollarToCent(row.unit_price_effective),
    qty: qtyToThousand(row.qty),
    measured_weight: qtyToThousand(row.measured_weight),
    subtotal: dollarToCent(row.subtotal),
    total: dollarToCent(row.total),
    tax_amount_included: dollarToCent(row.tax_amount_included),
    original_invoice_id: row.original_invoice_id,
    original_invoice_row_id: row.original_invoice_row_id,
    adjustments: row.adjustments,
    createdAt: row.createdAt,
  }));

  const payments = invoice.payments?.map((payment: any) => ({
    id: payment.id,
    invoiceId: payment.invoiceId,
    type: payment.type,
    amount: dollarToCent(payment.amount),
    surcharge: dollarToCent(payment.surcharge),
    entityType: payment.entityType ?? null,
    entityId: payment.entityId ?? null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  }));

  return {
    id: invoice.id,
    type: invoice.type,
    serialNumber: invoice.serialNumber,
    original_invoice_id: invoice.original_invoice_id,
    original_invoice_serialNumber: invoice.original_invoice_serialNumber,
    companyId: invoice.companyId,
    companyName: invoice.companyName,
    abn: invoice.abn,
    address1: invoice.address1,
    address2: invoice.address2,
    suburb: invoice.suburb,
    state: invoice.state,
    postcode: invoice.postcode,
    country: invoice.country,
    phone: invoice.phone,
    email: invoice.email,
    website: invoice.website,
    memberId: invoice.memberId,
    memberLevel: invoice.memberLevel,
    terminalId: invoice.terminalId,
    terminalName: invoice.terminal.name,
    shiftId: invoice.shiftId,
    userId: invoice.userId,
    userName: invoice.user.name,
    issuedAt: invoice.issuedAt,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    subtotal: dollarToCent(invoice.subtotal),
    documentDiscountAmount: dollarToCent(invoice.documentDiscountAmount),
    creditSurchargeAmount: dollarToCent(invoice.creditSurchargeAmount),
    rounding: dollarToCent(invoice.rounding),
    total: dollarToCent(invoice.total),
    taxAmount: dollarToCent(invoice.taxAmount),
    cashPaid: dollarToCent(invoice.cashPaid),
    cashChange: dollarToCent(invoice.cashChange),
    creditPaid: dollarToCent(invoice.creditPaid),
    voucherPaid: dollarToCent(invoice.voucherPaid),
    totalDiscountAmount: dollarToCent(invoice.totalDiscountAmount),
    rows: rows.map((r: any) => ({ ...r, id: undefined })),
    payments: payments.map((r: any) => ({ ...r, id: undefined })),
  };
}

export function convertShiftForCloud(shift: any) {
  return {
    localId: shift.id,
    companyId: shift.companyId,
    terminalId: shift.terminalId,
    terminalName: shift.terminal.name,
    dayStr: shift.dayStr,
    openedUserId: shift.openedUserId,
    openedUser: shift.openedUser,
    openedAt: shift.openedAt,
    openedNote: shift.openedNote,
    closedUserId: shift.closedUserId,
    closedUser: shift.closedUser,
    closedAt: shift.closedAt,
    closedNote: shift.closedNote,
    startedCach: shift.startedCach,
    endedCashExpected: shift.endedCashExpected,
    endedCashActual: shift.endedCashActual,
    salesCash: shift.salesCash,
    salesCredit: shift.salesCredit,
    salesVoucher: shift.salesVoucher,
    totalCashIn: shift.totalCashIn,
    totalCashOut: shift.totalCashOut,
    salesTax: shift.salesTax,
    refundsTax: shift.refundsTax,
    refundsCash: shift.refundsCash,
    refundsCredit: shift.refundsCredit,
    cashIn: shift.cashIn,
    cashOut: shift.cashOut,
  };
}

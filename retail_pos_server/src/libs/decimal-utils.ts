import { CashInOut, Prisma } from "../generated/prisma/client";

function toNum(v: Prisma.Decimal | null): number | null {
  if (v === null) return null;
  return Number(v);
}

function toNumReq(v: Prisma.Decimal): number {
  return Number(v);
}

export function numberifySaleInvoice<
  T extends {
    subtotal: Prisma.Decimal;
    documentDiscountAmount: Prisma.Decimal;
    creditSurchargeAmount: Prisma.Decimal;
    rounding: Prisma.Decimal;
    total: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    cashPaid: Prisma.Decimal;
    cashChange: Prisma.Decimal;
    creditPaid: Prisma.Decimal;
    totalDiscountAmount: Prisma.Decimal;
    rows?: unknown[];
    payments?: unknown[];
  },
>(invoice: T) {
  return {
    ...invoice,
    subtotal: toNumReq(invoice.subtotal),
    documentDiscountAmount: toNumReq(invoice.documentDiscountAmount),
    creditSurchargeAmount: toNumReq(invoice.creditSurchargeAmount),
    rounding: toNumReq(invoice.rounding),
    total: toNumReq(invoice.total),
    taxAmount: toNumReq(invoice.taxAmount),
    cashPaid: toNumReq(invoice.cashPaid),
    cashChange: toNumReq(invoice.cashChange),
    creditPaid: toNumReq(invoice.creditPaid),
    totalDiscountAmount: toNumReq(invoice.totalDiscountAmount),
    ...(invoice.rows && {
      rows: (invoice.rows as RawRow[]).map(numberifyRow),
    }),
    ...(invoice.payments && {
      payments: (invoice.payments as RawPayment[]).map(numberifyPayment),
    }),
  };
}

type RawRow = {
  barcodePrice: Prisma.Decimal | null;
  unit_price_original: Prisma.Decimal;
  unit_price_discounted: Prisma.Decimal | null;
  unit_price_adjusted: Prisma.Decimal | null;
  unit_price_effective: Prisma.Decimal;
  qty: Prisma.Decimal;
  measured_weight: Prisma.Decimal | null;
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
  tax_amount_included: Prisma.Decimal;
};

export function numberifyRow<T extends RawRow>(row: T) {
  return {
    ...row,
    barcodePrice: toNum(row.barcodePrice),
    unit_price_original: toNumReq(row.unit_price_original),
    unit_price_discounted: toNum(row.unit_price_discounted),
    unit_price_adjusted: toNum(row.unit_price_adjusted),
    unit_price_effective: toNumReq(row.unit_price_effective),
    qty: toNumReq(row.qty),
    measured_weight: toNum(row.measured_weight),
    subtotal: toNumReq(row.subtotal),
    total: toNumReq(row.total),
    tax_amount_included: toNumReq(row.tax_amount_included),
  };
}

type RawPayment = {
  amount: Prisma.Decimal;
  surcharge: Prisma.Decimal;
};

function numberifyPayment<T extends RawPayment>(payment: T) {
  return {
    ...payment,
    amount: toNumReq(payment.amount),
    surcharge: toNumReq(payment.surcharge),
  };
}

export function numberifyCashInOut<T extends CashInOut>(cashInOut: T) {
  return {
    ...cashInOut,
    amount: toNumReq(cashInOut.amount),
  };
}

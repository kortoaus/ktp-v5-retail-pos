import { PaymentPayload, SaleRowPayload } from "./sale.types";

export interface CalculateInvoicePointsInput {
  type: "SALE" | "SPEND" | "REFUND";
  member: { id: string } | null;
  rows: Pick<SaleRowPayload, "total" | "isPointExcluded">[];
  payments: Pick<PaymentPayload, "type" | "amount">[];
  linesTotal: number;
  nonCashBill: number;
  voucherBill: number;
  cashPointRate: number;
  otherPointRate: number;
}

export function calculateInvoicePoints({
  type,
  member,
  rows,
  payments,
  linesTotal,
  nonCashBill,
  voucherBill,
  cashPointRate,
  otherPointRate,
}: CalculateInvoicePointsInput): number {
  if (type !== "SALE" || member == null || linesTotal <= 0) return 0;

  const eligiblePointBase = rows.reduce(
    (sum, row) => sum + (row.isPointExcluded ? 0 : row.total),
    0,
  );
  if (eligiblePointBase <= 0) return 0;

  const cashApplied = payments
    .filter((payment) => payment.type === "CASH")
    .reduce((sum, payment) => sum + payment.amount, 0);

  const cappedCashApplied = Math.min(Math.max(0, cashApplied), linesTotal);
  const cappedVoucherBill = Math.min(Math.max(0, voucherBill), linesTotal);
  const earningPointBase = Math.round(
    (eligiblePointBase * (linesTotal - cappedVoucherBill)) / linesTotal,
  );
  const cashPointBase =
    nonCashBill <= 0 && cappedCashApplied > 0
      ? eligiblePointBase
      : Math.round((eligiblePointBase * cappedCashApplied) / linesTotal);
  const otherPointBase = Math.max(0, earningPointBase - cashPointBase);

  return (
    Math.round((cashPointBase * cashPointRate) / 1000) +
    Math.round((otherPointBase * otherPointRate) / 1000)
  );
}

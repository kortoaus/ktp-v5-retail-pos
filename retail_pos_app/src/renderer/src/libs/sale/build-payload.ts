import { SaleStoreDiscount } from "../../types/sales";
import {
  DocumentAdjustments,
  FinalizedLine,
  PaymentCalcResult,
  SaleTotals,
  TaxCalcResult,
} from "./types";

export interface CreateSaleInvoicePayload {
  subtotal: number;
  documentDiscountAmount: number;
  creditSurchargeAmount: number;
  rounding: number;
  total: number;
  taxAmount: number;
  cashPaid: number;
  cashChange: number;
  creditPaid: number;
  voucherPaid: number;
  totalDiscountAmount: number;
  memberId: string | null;
  memberLevel: number | null;
  rows: InvoiceRowPayload[];
  payments: { type: string; amount: number; surcharge: number; entityType?: string; entityId?: number; voucher_balance?: number }[];
  discounts: { entityType: string; entityId: number; title: string; description: string; amount: number }[];
}

interface InvoiceRowPayload {
  type: string;
  itemId: number;
  name_en: string;
  name_ko: string;
  taxable: boolean;
  uom: string;
  barcode: string;
  index: number;
  barcodePrice: number | null;
  unit_price_original: number;
  unit_price_discounted: number | null;
  unit_price_adjusted: number | null;
  unit_price_effective: number;
  qty: number;
  measured_weight: number | null;
  subtotal: number;
  total: number;
  original_invoice_id: number | null;
  original_invoice_row_id: number | null;
  adjustments: string[];
  tax_amount_included: number;
  discount_amount: number;
}

function sanitizeRow(line: FinalizedLine): InvoiceRowPayload {
  return {
    type: line.type,
    itemId: line.itemId,
    name_en: line.name_en,
    name_ko: line.name_ko,
    taxable: line.taxable,
    uom: line.uom,
    barcode: line.barcode,
    index: line.index,
    barcodePrice: line.barcode_price,
    unit_price_original: line.unit_price_original,
    unit_price_discounted: line.unit_price_discounted,
    unit_price_adjusted: line.unit_price_adjusted,
    unit_price_effective: line.unit_price_effective,
    qty: line.qty,
    measured_weight: line.measured_weight,
    subtotal: line.total - line.tax_amount_included,
    total: line.total,
    original_invoice_id: line.original_invoice_id,
    original_invoice_row_id: line.original_invoice_row_id,
    adjustments: line.adjustments,
    tax_amount_included: line.tax_amount_included,
    discount_amount: line.discount_amount,
  };
}

export function buildPayload(
  finalizedLines: FinalizedLine[],
  saleTotals: SaleTotals,
  docAdj: DocumentAdjustments,
  paymentCalc: PaymentCalcResult,
  taxCalc: TaxCalcResult,
  member: { id: string; level: number } | null,
  discounts: SaleStoreDiscount[],
): CreateSaleInvoicePayload {
  const cashPaid = paymentCalc.appliedPaymentLines
    .filter((p) => p.type === "cash")
    .reduce((acc, p) => acc + p.amount, 0);

  return {
    subtotal: saleTotals.subTotal,
    documentDiscountAmount: docAdj.documentDiscountAmount,
    creditSurchargeAmount: paymentCalc.totalSurcharge,
    rounding: paymentCalc.effectiveRounding,
    total: paymentCalc.effectiveDue + paymentCalc.totalSurcharge,
    taxAmount: taxCalc.taxAmount,
    cashPaid,
    cashChange: paymentCalc.changeAmount,
    creditPaid: paymentCalc.totalCredit,
    voucherPaid: paymentCalc.totalVoucher,
    totalDiscountAmount: docAdj.totalDiscountAmount,
    memberId: member?.id ?? null,
    memberLevel: member?.level ?? null,
    rows: finalizedLines.map(sanitizeRow),
    payments: paymentCalc.appliedPaymentLines.map((p) => ({
      type: p.type,
      amount: p.amount,
      surcharge: p.surcharge,
      ...(p.type === "voucher" && {
        entityType: p.entityType,
        entityId: p.entityId,
        voucher_balance: p.voucher_balance,
      }),
    })),
    discounts: discounts.map((d) => ({
      entityType: d.entityType,
      entityId: d.entityId,
      title: d.title,
      description: d.description,
      amount: d.amount,
    })),
  };
}

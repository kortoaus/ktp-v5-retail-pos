import { SaleLineType, SaleStoreDiscount } from "../../types/sales";

export interface SaleTotals {
  lineTotal: number;
  subTotal: number;
  lineDiscountAmount: number;
}

export interface DocumentAdjustments {
  documentDiscountAmount: number;
  exactDue: number;
  roundedDue: number;
  rounding: number;
  totalDiscountAmount: number;
}

export interface Payment {
  type: "cash" | "credit" | "voucher";
  amount: number;
  entityType?: "user-voucher" | "member-voucher";
  entityId?: number;
  voucher_balance?: number;
}

export interface PaymentLine {
  type: "cash" | "credit" | "voucher";
  amount: number;
  surcharge: number;
  eftpos: number;
  entityType?: "user-voucher" | "member-voucher";
  entityId?: number;
  voucher_balance?: number;
}

export interface PaymentCalcResult {
  totalCash: number;
  totalCredit: number;
  totalVoucher: number;
  totalSurcharge: number;
  totalEftpos: number;
  hasCash: boolean;
  effectiveDue: number;
  effectiveRounding: number;
  remaining: number;
  changeAmount: number;
  shortAmount: number;
  isShort: boolean;
  isOverpaid: boolean;
  canPay: boolean;
  allPaymentLines: PaymentLine[];
  appliedPaymentLines: PaymentLine[];
}

export interface TaxCalcResult {
  goodsTaxAmount: number;
  surchargeTaxAmount: number;
  taxAmount: number;
}

export interface FinalizedLine extends SaleLineType {
  discount_amount: number;
  tax_amount_included: number;
}

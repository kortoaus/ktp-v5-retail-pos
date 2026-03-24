import { useMemo } from "react";
import { SaleLineType, SaleStoreDiscount } from "../../types/sales";
import { calcDocumentAdjustments } from "../../libs/sale/calc-sale-totals";
import { calcPayments } from "../../libs/sale/calc-payments";
import { calcTax } from "../../libs/sale/finalize-lines";
import { SaleTotals, Payment } from "../../libs/sale/types";

export interface UseNewPaymentCalcInputs {
  saleTotals: SaleTotals;
  lines: SaleLineType[];
  discounts: SaleStoreDiscount[];
  documentDiscountMethod: "percent" | "amount";
  documentDiscountValue: number;
  committedPayments: Payment[];
  stagingCash: number;
  stagingCredit: number;
  surchargeRate: number;
}

export function useNewPaymentCalc({
  saleTotals,
  lines,
  discounts,
  documentDiscountMethod,
  documentDiscountValue,
  committedPayments,
  stagingCash,
  stagingCredit,
  surchargeRate,
}: UseNewPaymentCalcInputs) {
  const docAdj = useMemo(
    () =>
      calcDocumentAdjustments(
        saleTotals.subTotal,
        saleTotals.lineDiscountAmount,
        documentDiscountMethod,
        documentDiscountValue,
      ),
    [saleTotals.subTotal, saleTotals.lineDiscountAmount, documentDiscountMethod, documentDiscountValue],
  );

  const paymentCalc = useMemo(
    () => calcPayments(docAdj, committedPayments, stagingCash, stagingCredit, surchargeRate),
    [docAdj, committedPayments, stagingCash, stagingCredit, surchargeRate],
  );

  const taxCalc = useMemo(
    () =>
      calcTax(
        lines,
        discounts,
        docAdj.documentDiscountAmount,
        paymentCalc.totalSurcharge,
      ),
    [lines, discounts, docAdj.documentDiscountAmount, paymentCalc.totalSurcharge],
  );

  return { saleTotals, docAdj, paymentCalc, taxCalc };
}

import { useMemo } from "react";
import { Decimal } from "decimal.js";
import { MONEY_DP } from "../../libs/constants";
import { SaleLineType } from "../../types/sales";

const CREDIT_SURCHARGE_RATE = 0.015; // 1.5%

const r2 = (d: Decimal) => d.toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);

export interface PaymentCalcInputs {
  lines: SaleLineType[];
  documentDiscountMethod: "percent" | "amount";
  documentDiscountValue: number;
  cashReceived: number;
  creditReceived: number;
}

export function usePaymentCalc({
  lines,
  documentDiscountMethod,
  documentDiscountValue,
  cashReceived,
  creditReceived,
}: PaymentCalcInputs) {
  const subTotal = useMemo(() => {
    return lines.reduce((acc, line) => {
      return acc.add(new Decimal(line.total));
    }, new Decimal(0));
  }, [lines]);

  const taxableRatio = useMemo(() => {
    if (subTotal.isZero()) return new Decimal(0);
    const taxableTotal = lines
      .filter((line) => line.taxable)
      .reduce((acc, line) => acc.add(new Decimal(line.total)), new Decimal(0));
    return taxableTotal.div(subTotal);
  }, [lines, subTotal]);

  const documentDiscountAmount = useMemo(() => {
    if (documentDiscountMethod === "percent") {
      const factor = new Decimal(documentDiscountValue).div(100);
      return r2(subTotal.mul(factor));
    }
    return new Decimal(documentDiscountValue);
  }, [subTotal, documentDiscountMethod, documentDiscountValue]);

  const exactDue = useMemo(
    () => subTotal.sub(documentDiscountAmount),
    [subTotal, documentDiscountAmount],
  );

  const roundedDue = useMemo(
    () => exactDue.toNearest(new Decimal("0.05"), Decimal.ROUND_HALF_UP),
    [exactDue],
  );

  const rounding = useMemo(
    () => roundedDue.sub(exactDue),
    [roundedDue, exactDue],
  );

  const creditSurchargeAmount = useMemo(
    () => r2(new Decimal(creditReceived).mul(CREDIT_SURCHARGE_RATE)),
    [creditReceived],
  );

  const eftposAmount = useMemo(
    () => r2(new Decimal(creditReceived).add(creditSurchargeAmount)),
    [creditReceived, creditSurchargeAmount],
  );

  const taxAmount = useMemo(() => {
    const taxableGoods = exactDue.mul(taxableRatio);
    const taxableSurcharge = creditSurchargeAmount.mul(taxableRatio);
    return r2(taxableGoods.add(taxableSurcharge).div(11));
  }, [exactDue, taxableRatio, creditSurchargeAmount]);

  const remaining = useMemo(
    () =>
      roundedDue
        .sub(new Decimal(cashReceived))
        .sub(new Decimal(creditReceived)),
    [roundedDue, cashReceived, creditReceived],
  );

  const lineDiscountAmount = useMemo(() => {
    const originalSubTotal = lines.reduce((acc, line) => {
      return acc.add(new Decimal(line.unit_price_original).mul(line.qty));
    }, new Decimal(0));
    return r2(originalSubTotal.sub(subTotal));
  }, [lines, subTotal]);

  const totalDiscountAmount = useMemo(
    () => lineDiscountAmount.add(documentDiscountAmount),
    [lineDiscountAmount, documentDiscountAmount],
  );

  const isShort = remaining.gt(0);
  const isOverpaid = remaining.lt(0);
  const changeAmount = isOverpaid ? remaining.abs() : new Decimal(0);
  const shortAmount = isShort ? remaining : new Decimal(0);
  const canPay = !isShort;

  return {
    subTotal,
    documentDiscountAmount,
    exactDue,
    roundedDue,
    rounding,
    creditSurchargeAmount,
    eftposAmount,
    taxAmount,
    remaining,
    lineDiscountAmount,
    totalDiscountAmount,
    isShort,
    isOverpaid,
    changeAmount,
    shortAmount,
    canPay,
  };
}

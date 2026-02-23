import { useMemo } from "react";
import { Decimal } from "decimal.js";
import { MONEY_DP } from "../../libs/constants";
import { SaleLineType } from "../../types/sales";

const CREDIT_SURCHARGE_RATE = 0.015; // 1.5%

const r2 = (d: Decimal) => d.toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);

export interface Payment {
  type: "cash" | "credit";
  amount: number;
}
export interface PaymentLine {
  type: "cash" | "credit";
  amount: Decimal;
  surcharge: Decimal;
  eftpos: Decimal;
}

export interface PaymentCalcInputs {
  lines: SaleLineType[];
  documentDiscountMethod: "percent" | "amount";
  documentDiscountValue: number;
  committedPayments: Payment[];
  stagingCash: number;
  stagingCredit: number;
}



export function usePaymentCalc({
  lines,
  documentDiscountMethod,
  documentDiscountValue,
  committedPayments,
  stagingCash,
  stagingCredit,
}: PaymentCalcInputs) {
  /* ── Sale-level calculations (unchanged) ───────────── */

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

  /* ── Payment lines (committed + staging) ───────────── */

  const allPaymentLines = useMemo(() => {
    const result: PaymentLine[] = committedPayments.map((p) => {
      const amt = new Decimal(p.amount);
      if (p.type === "credit") {
        const sc = r2(amt.mul(CREDIT_SURCHARGE_RATE));
        return { type: p.type, amount: amt, surcharge: sc, eftpos: amt.add(sc) };
      }
      return { type: p.type, amount: amt, surcharge: new Decimal(0), eftpos: amt };
    });

    if (stagingCash > 0) {
      const amt = new Decimal(stagingCash);
      result.push({ type: "cash", amount: amt, surcharge: new Decimal(0), eftpos: amt });
    }
    if (stagingCredit > 0) {
      const amt = new Decimal(stagingCredit);
      const sc = r2(amt.mul(CREDIT_SURCHARGE_RATE));
      result.push({ type: "credit", amount: amt, surcharge: sc, eftpos: amt.add(sc) });
    }

    return result;
  }, [committedPayments, stagingCash, stagingCredit]);

  /* ── Payment aggregates ────────────────────────────── */

  const totalCash = useMemo(
    () =>
      allPaymentLines
        .filter((p) => p.type === "cash")
        .reduce((acc, p) => acc.add(p.amount), new Decimal(0)),
    [allPaymentLines],
  );

  const totalCredit = useMemo(
    () =>
      allPaymentLines
        .filter((p) => p.type === "credit")
        .reduce((acc, p) => acc.add(p.amount), new Decimal(0)),
    [allPaymentLines],
  );

  const totalSurcharge = useMemo(
    () => allPaymentLines.reduce((acc, p) => acc.add(p.surcharge), new Decimal(0)),
    [allPaymentLines],
  );

  const totalEftpos = useMemo(
    () => totalCredit.add(totalSurcharge),
    [totalCredit, totalSurcharge],
  );

  /* ── Cash rounding ─────────────────────────────────── */

  const hasCash = totalCash.gt(0);

  const effectiveDue = useMemo(
    () => (hasCash ? roundedDue : exactDue),
    [hasCash, roundedDue, exactDue],
  );

  const effectiveRounding = useMemo(
    () => (hasCash ? roundedDue.sub(exactDue) : new Decimal(0)),
    [hasCash, roundedDue, exactDue],
  );

  /* ── Remaining / status ────────────────────────────── */

  const remaining = useMemo(
    () => effectiveDue.sub(totalCash).sub(totalCredit),
    [effectiveDue, totalCash, totalCredit],
  );

  const isShort = useMemo(() => remaining.gt(0), [remaining]);
  const isOverpaid = useMemo(() => remaining.lt(0), [remaining]);
  const changeAmount = useMemo(
    () => (remaining.lt(0) ? remaining.abs() : new Decimal(0)),
    [remaining],
  );
  const shortAmount = useMemo(
    () => (remaining.gt(0) ? remaining : new Decimal(0)),
    [remaining],
  );
  const canPay = useMemo(() => !remaining.gt(0), [remaining]);

  /* ── Tax (GST extracted from sale + surcharge) ─────── */

  const taxAmount = useMemo(() => {
    const taxableGoods = exactDue.mul(taxableRatio);
    const taxableSurcharge = totalSurcharge.mul(taxableRatio);
    return r2(taxableGoods.add(taxableSurcharge).div(11));
  }, [exactDue, taxableRatio, totalSurcharge]);

  return {
    subTotal,
    documentDiscountAmount,
    exactDue,
    roundedDue,
    rounding,
    effectiveDue,
    effectiveRounding,
    lineDiscountAmount,
    totalDiscountAmount,
    allPaymentLines,
    totalCash,
    totalCredit,
    totalSurcharge,
    totalEftpos,
    hasCash,
    taxAmount,
    remaining,
    isShort,
    isOverpaid,
    changeAmount,
    shortAmount,
    canPay,
  };
}

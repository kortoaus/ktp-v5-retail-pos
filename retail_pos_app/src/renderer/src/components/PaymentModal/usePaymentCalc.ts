import { useMemo } from "react";
import { Decimal } from "decimal.js";
import { MONEY_DP } from "../../libs/constants";
import { SaleLineType } from "../../types/sales";

// const CREDIT_SURCHARGE_RATE = 0.015; // 1.5%

const CENT = new Decimal("0.01");
const floor2 = (d: Decimal) => d.toDecimalPlaces(MONEY_DP, Decimal.ROUND_FLOOR);
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
  CREDIT_SURCHARGE_RATE: number;
}

export function usePaymentCalc({
  lines,
  documentDiscountMethod,
  documentDiscountValue,
  committedPayments,
  stagingCash,
  stagingCredit,
  CREDIT_SURCHARGE_RATE,
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
        return {
          type: p.type,
          amount: amt,
          surcharge: sc,
          eftpos: amt.add(sc),
        };
      }
      return {
        type: p.type,
        amount: amt,
        surcharge: new Decimal(0),
        eftpos: amt,
      };
    });

    if (stagingCash > 0) {
      const amt = new Decimal(stagingCash);
      result.push({
        type: "cash",
        amount: amt,
        surcharge: new Decimal(0),
        eftpos: amt,
      });
    }
    if (stagingCredit > 0) {
      const amt = new Decimal(stagingCredit);
      const sc = r2(amt.mul(CREDIT_SURCHARGE_RATE));
      result.push({
        type: "credit",
        amount: amt,
        surcharge: sc,
        eftpos: amt.add(sc),
      });
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
    () =>
      allPaymentLines.reduce((acc, p) => acc.add(p.surcharge), new Decimal(0)),
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

  const goodsTaxAmount = useMemo(() => {
    const taxableGoods = exactDue.mul(taxableRatio);
    return r2(taxableGoods.div(11));
  }, [exactDue, taxableRatio]);

  const surchargeTaxAmount = useMemo(() => {
    return r2(totalSurcharge.div(11));
  }, [totalSurcharge]);

  const taxAmount = useMemo(() => {
    return goodsTaxAmount.add(surchargeTaxAmount);
  }, [goodsTaxAmount, surchargeTaxAmount]);

  function calTaxAmountByLineExact(
    lines: SaleLineType[],
    totalTaxAmount: Decimal,
  ) {
    const taxable = lines
      .map((l, idx) => ({ ...l, idx }))
      .filter((l) => l.taxable);

    const taxableTotal = taxable.reduce(
      (acc, l) => acc.add(new Decimal(l.total)),
      new Decimal(0),
    );

    // 전부 면세면 0
    if (taxableTotal.isZero()) {
      return lines.map((l) => ({ ...l, taxAmount: 0 }));
    }

    // 1) 정밀 배분값
    const alloc = taxable.map((l) => {
      const ratio = new Decimal(l.total).div(taxableTotal);
      const precise = totalTaxAmount.mul(ratio); // 무한정밀
      const floored = floor2(precise); // 2dp 내림
      const frac = precise.sub(floored); // 나머지(소수부분)
      return { idx: l.idx, precise, floored, frac };
    });

    // 2) 내림 합
    const flooredSum = alloc.reduce(
      (acc, a) => acc.add(a.floored),
      new Decimal(0),
    );

    // 3) 남은 센트 계산 (totalTaxAmount도 2dp 확정이라고 가정하지만 안전하게 r2)
    const target = r2(totalTaxAmount);
    let remainder = target.sub(flooredSum);

    // remainder가 음수면(이론상 거의 없음) 반대로 처리
    // (여기선 방어만)
    const sign = remainder.gte(0) ? 1 : -1;
    remainder = remainder.abs();

    const centsToDistribute = remainder.div(CENT).toNumber(); // 정수여야 함

    // 4) 소수부분 큰 순서로 정렬해서 0.01씩 분배
    // 동률이면 idx로 tie-break 해서 항상 deterministic
    alloc.sort((a, b) => {
      const c = b.frac.comparedTo(a.frac);
      return c !== 0 ? c : a.idx - b.idx;
    });

    // 5) 라인별 taxAmount = floored + distributed cents
    const byIdx = new Map<number, Decimal>();
    for (const a of alloc) byIdx.set(a.idx, a.floored);

    for (let i = 0; i < centsToDistribute; i++) {
      const a = alloc[i % alloc.length];
      byIdx.set(a.idx, byIdx.get(a.idx)!.add(CENT.mul(sign)));
    }

    // 6) 결과 매핑 (면세=0, 과세=확정 2dp)
    return lines.map((l, idx) => {
      if (!l.taxable) return { ...l, taxAmount: 0 };
      const amt = byIdx.get(idx) ?? new Decimal(0);
      return { ...l, taxAmount: amt.toNumber() }; // 이미 2dp 확정
    });
  }

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
    goodsTaxAmount,
    surchargeTaxAmount,
    calTaxAmountByLineExact,
  };
}

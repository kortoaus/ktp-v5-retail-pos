import { useMemo } from "react";
import type { SaleLineType } from "../../../types/sales";
import type { PaymentQueueItem } from "./types";

// ──────────────────────────────────────────────────────────────
// usePaymentCal — PaymentModal 전체 금액 계산 허브.
//
// 입력: cart lines + payments ([staged, ...committed] 합쳐서 전달).
// 출력: invoice-level 합계, tax 분해, cash 분배, paid/remaining/change.
//
// INVARIANT (sale-domain.md §2, D-12):
//   Invoice.total       = linesTotal + rounding + creditSurcharge
//   Σ payments.amount   == Invoice.total
//   paid (bill terms)   = nonCashBill + cashApplied  → due 일 때 완납
//
// 용어:
//   bill     — surcharge 제외한 "상품값 부분" (linesTotal 기준)
//   eftpos   — CREDIT payment 에서 카드에 실제 긁힌 금액 (bill + surcharge)
//   due      — customer 가 BILL 단위로 내야 할 총액 (= linesTotal + rounding)
//   total    — 실제 customer 가 낸 gross (= due + creditSurcharge). Invoice.total.
// ──────────────────────────────────────────────────────────────

// Surcharge rate: per-1000 (15 = 1.5%). Integer math로 FP error 회피.
//   surcharge = round(bill × rate / 1000)
export function surchargeOf(
  billPortion: number,
  surchargeRate: number,
): number {
  return Math.round((billPortion * surchargeRate) / 1000);
}

// EFTPOS 에 실제 긁힐 금액. Display UI 와 staged 저장이 이 단일 헬퍼를 공유해서
// 1¢ 불일치를 원천 차단.
export function eftposAmountOf(
  billPortion: number,
  surchargeRate: number,
): number {
  return billPortion + surchargeOf(billPortion, surchargeRate);
}

// Payment → bill portion (paid/remaining 계산 단위).
//   CREDIT   : inverse of eftposAmountOf → round(amount × 1000 / (1000 + rate))
//   그 외     : amount 가 곧 bill portion (surcharge 없음)
export function billPortionOf(
  p: PaymentQueueItem,
  surchargeRate: number,
): number {
  if (p.tender === "CREDIT") {
    return Math.round((p.amount * 1000) / (1000 + surchargeRate));
  }
  return p.amount;
}

// AU 5¢ rounding — 가장 가까운 5¢ 로 반올림 (1¢/2¢ 코인 없음).
//   7342 → 7340   7343 → 7345   7345 → 7345
export function round5(cents: number): number {
  return Math.round(cents / 5) * 5;
}

// 현재 active tender input 의 cap ("staged 제외 committed 만으로 얼마나 남았나").
// 훅의 allocation 로직을 committed-only 로 미러링. 부모가 usePaymentCal 을 두 번
// 호출하지 않고 cap 만 빠르게 구하게 해주는 우회로.
export function calcLeft(
  committedPayments: PaymentQueueItem[],
  due: number,
  surchargeRate: number,
): number {
  const nonCashBill = committedPayments.reduce(
    (s, p) =>
      p.tender === "CASH" ? s : s + billPortionOf(p, surchargeRate),
    0,
  );
  const cashIntent = committedPayments.reduce(
    (s, p) => (p.tender === "CASH" ? s + p.cashReceived : s),
    0,
  );
  const cashApplied = Math.min(cashIntent, Math.max(0, due - nonCashBill));
  return Math.max(0, due - nonCashBill - cashApplied);
}

export function usePaymentCal({
  lines,
  credit_surcharge_rate,
  payments,
}: {
  lines: SaleLineType[];
  credit_surcharge_rate: number;
  payments: PaymentQueueItem[];
}) {
  // ── 1. LINES ───────────────────────────────────────────────
  // linesTotal 은 tax-inclusive. lineTax 는 per-line round 후 sum (invoice-level
  // 에서 round(net × 0.1) 을 다시 계산하면 1¢ drift 발생 — sale-domain.md §0).
  const linesTotal = useMemo(
    () => lines.reduce((s, l) => s + l.total, 0),
    [lines],
  );
  const lineTax = useMemo(
    () => lines.reduce((s, l) => s + l.tax_amount, 0),
    [lines],
  );

  // ── 2. PAYMENT INTENT (tender 별 합계) ─────────────────────
  // nonCashBill  : CREDIT(bill portion) + VOUCHER + GIFTCARD 의 bill-terms 합
  // cashIntent   : CASH 의 cashReceived 총합 (실제 받은 현금, applied 와 구별)
  // creditSurcharge : CREDIT amount 에서 bill 부분을 뺀 순수 surcharge 합
  const nonCashBill = useMemo(
    () =>
      payments.reduce(
        (s, p) =>
          p.tender === "CASH" ? s : s + billPortionOf(p, credit_surcharge_rate),
        0,
      ),
    [payments, credit_surcharge_rate],
  );
  const cashIntent = useMemo(
    () =>
      payments.reduce(
        (s, p) => (p.tender === "CASH" ? s + p.cashReceived : s),
        0,
      ),
    [payments],
  );
  const creditSurcharge = useMemo(
    () =>
      payments.reduce(
        (s, p) =>
          p.tender === "CREDIT"
            ? s + (p.amount - billPortionOf(p, credit_surcharge_rate))
            : s,
        0,
      ),
    [payments, credit_surcharge_rate],
  );

  // ── 3. ROUNDING (AU 5¢) ────────────────────────────────────
  // CASH 가 유일한 tender 이고 실제로 settle 가능할 때만 적용. Mixed / card-only
  // 는 항상 exact — non-cash tender 가 1¢ 정밀도를 받을 수 있으므로.
  //   (a) nonCashBill === 0               — 비-현금 tender 부재
  //   (b) cashIntent >= roundedCashTarget — 현금이 round 된 타겟을 덮음
  //   (c) cashTarget !== roundedCashTarget — bill 이 아직 5¢ 배수 아님
  //
  // 예:
  //   $100.01 cash-only $200 → round $100, change $100
  //   $100.01 cash $99 + credit $1 → NO round (credit 이 $0.01 받음)
  //   $100.01 card-only → NO round
  const cashOnlyMode = nonCashBill === 0;
  const cashTarget = Math.max(0, linesTotal - nonCashBill);
  const roundedCashTarget = round5(cashTarget);
  const cashCanSettle =
    cashOnlyMode && cashIntent > 0 && cashIntent >= roundedCashTarget;
  const needsRounding = cashTarget !== roundedCashTarget;
  const rounding =
    cashCanSettle && needsRounding ? roundedCashTarget - cashTarget : 0;

  // ── 4. INVOICE TOTALS ──────────────────────────────────────
  // due  : BILL terms — customer 가 "상품+rounding" 으로 내야 할 합
  // total: GROSS — due + surcharge. Invoice.total 과 동일 (D-12).
  const due = linesTotal + rounding;
  const total = due + creditSurcharge;

  // ── 5. TAX BREAKDOWN ───────────────────────────────────────
  // lineTax    : items 의 GST 합 (위에서 계산)
  // surchargeTax: surcharge 에도 GST 10% 적용. ATO: surcharge 는 supply 의 일부.
  //   Tax-inclusive 관례 → surchargeTax = round(surcharge / 11).
  // net        : (linesTotal + creditSurcharge) - (lineTax + surchargeTax)
  //              rounding 은 세금 외 조정이라 net 계산에 포함 안 함.
  const surchargeTax = Math.round(creditSurcharge / 11);
  const tax = lineTax + surchargeTax;
  const net = linesTotal + creditSurcharge - tax;

  // ── 6. CASH APPLICATION ────────────────────────────────────
  // CASH 는 dynamic pool: 저장된 `amount` 는 신뢰하지 않고, 받은 현금이 남은
  // bill 간극 (due - nonCashBill) 을 채우는 만큼만 applied 로 집계.
  //   cashApplied = min(cashIntent, max(0, due - nonCashBill))
  //   change      = cashIntent - cashApplied
  const cashApplied = Math.min(cashIntent, Math.max(0, due - nonCashBill));
  const change = cashIntent - cashApplied;

  // ── 7. CASH FIFO ALLOCATION (per-item) ────────────────────
  // Pending list 디스플레이용. Committed cash 가 먼저 흡수 (insertion order),
  // staged("staged" key) 가 마지막 leftover 를 채움. 비-현금 committed 가 제거
  // 되면 cash 가 자동으로 더 흡수 — stale amount 없음.
  const cashAllocations = useMemo(() => {
    const map = new Map<string, number>();
    const ordered = [
      ...payments.filter((p) => p.tender === "CASH" && p.key !== "staged"),
      ...payments.filter((p) => p.tender === "CASH" && p.key === "staged"),
    ];
    let remaining = cashApplied;
    for (const c of ordered) {
      if (c.tender !== "CASH") continue;
      const allocated = Math.min(c.cashReceived, remaining);
      map.set(c.key, allocated);
      remaining -= allocated;
    }
    return map;
  }, [payments, cashApplied]);

  // ── 8. PAID / REMAINING (BILL terms) ───────────────────────
  // paid 가 due 에 도달하면 완납. Complete Sale 버튼 활성화 조건.
  const paid = nonCashBill + cashApplied;
  const remaining = Math.max(0, due - paid);

  return {
    // Lines
    linesTotal,
    // Tax
    lineTax,
    surchargeTax,
    tax,
    net,
    // Invoice totals
    rounding,
    due,
    creditSurcharge,
    total,
    // Cash
    nonCashBill,
    cashIntent,
    cashApplied,
    cashAllocations,
    change,
    // Settlement
    paid,
    remaining,
  };
}

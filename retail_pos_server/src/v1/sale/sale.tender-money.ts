import { BadRequestException } from "../../libs/exceptions";
import type { SaleCreatePayload } from "./sale.types";

// F-24 (T-26): the server derives a SALE's cash rounding and credit surcharge from
// its tenders and the store rate instead of trusting the till's numbers. Shared
// with repay (billPortionOfCredit / surchargeRateOf moved here from
// sale.repay.service.ts, which re-exports them).

/** storeSetting.credit_surcharge_rate (per-1000; 15 = 1.5%), default 15 as on the tills. */
export function surchargeRateOf(storeSetting: {
  credit_surcharge_rate: number | null;
}): number {
  return storeSetting.credit_surcharge_rate ?? 15;
}

/** CREDIT payment.amount (EFTPOS keyed = bill + surcharge) → its bill portion: round(amount × 1000 / (1000 + rate)). */
export function billPortionOfCredit(amount: number, rate: number): number {
  return Math.round((amount * 1000) / (1000 + rate));
}

/**
 * The till's SALE rules (retail_pos_app usePaymentCal.ts, copied verbatim into the
 * Runner) evaluated on the posted tenders:
 *   creditSurcharge = Σ CREDIT (amount − billPortionOfCredit(amount, rate))
 *   rounding (AU 5¢) only when no exact non-cash tender (CREDIT / GIFTCARD) is
 *   present: cashTarget = max(0, linesTotal − Σ VOUCHER), rounded = round5(cashTarget),
 *   applied when the cash received (Σ CASH applied + cashChange) covers `rounded`.
 * The till additionally requires a CASH tender to be present (a $0 staged cash
 * slot counts, which the payload cannot show); with Σ payments == total enforced
 * by validateAmounts, dropping that condition gives the same answer for every
 * payload a till can produce.
 */
export function deriveSaleTenderAmounts(
  p: Pick<SaleCreatePayload, "linesTotal" | "cashChange" | "payments">,
  surchargeRate: number,
): { rounding: number; creditSurchargeAmount: number } {
  let creditSurchargeAmount = 0;
  let exactNonCashBill = 0;
  let voucherBill = 0;
  let cashApplied = 0;
  for (const payment of p.payments) {
    if (payment.type === "CREDIT") {
      const bill = billPortionOfCredit(payment.amount, surchargeRate);
      creditSurchargeAmount += payment.amount - bill;
      exactNonCashBill += bill;
    } else if (payment.type === "GIFTCARD") {
      exactNonCashBill += payment.amount;
    } else if (payment.type === "VOUCHER") {
      voucherBill += payment.amount;
    } else {
      cashApplied += payment.amount;
    }
  }

  let rounding = 0;
  if (exactNonCashBill === 0) {
    const cashTarget = Math.max(0, p.linesTotal - voucherBill);
    const roundedCashTarget = Math.round(cashTarget / 5) * 5;
    const cashReceived = cashApplied + p.cashChange;
    if (cashReceived >= roundedCashTarget) rounding = roundedCashTarget - cashTarget;
  }
  return { rounding, creditSurchargeAmount };
}

/** Rejects (400, same contract as validateAmounts) a SALE whose rounding or creditSurchargeAmount differs from the derivation. */
export function assertSaleTenderAmounts(
  p: Pick<SaleCreatePayload, "linesTotal" | "cashChange" | "payments" | "rounding" | "creditSurchargeAmount">,
  surchargeRate: number,
): void {
  const expected = deriveSaleTenderAmounts(p, surchargeRate);
  if (p.creditSurchargeAmount !== expected.creditSurchargeAmount)
    throw new BadRequestException(
      `creditSurchargeAmount mismatch: got ${p.creditSurchargeAmount}, expected ${expected.creditSurchargeAmount}`,
    );
  if (p.rounding !== expected.rounding)
    throw new BadRequestException(
      `rounding mismatch: got ${p.rounding}, expected ${expected.rounding}`,
    );
}

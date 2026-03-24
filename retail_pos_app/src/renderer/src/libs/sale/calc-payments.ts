import { PCT_SCALE } from "../constants";
import { DocumentAdjustments, Payment, PaymentCalcResult, PaymentLine } from "./types";

function buildPaymentLines(
  committedPayments: Payment[],
  stagingCash: number,
  stagingCredit: number,
  surchargeRate: number,
): PaymentLine[] {
  const lines: PaymentLine[] = committedPayments.map((p) => {
    if (p.type === "credit") {
      const sc = Math.round((p.amount * surchargeRate) / PCT_SCALE);
      return { type: p.type, amount: p.amount, surcharge: sc, eftpos: p.amount + sc };
    }
    return {
      type: p.type,
      amount: p.amount,
      surcharge: 0,
      eftpos: p.amount,
      entityType: p.entityType,
      entityId: p.entityId,
      voucher_balance: p.voucher_balance,
    };
  });

  if (stagingCash > 0) {
    lines.push({ type: "cash", amount: stagingCash, surcharge: 0, eftpos: stagingCash });
  }
  if (stagingCredit > 0) {
    const sc = Math.round((stagingCredit * surchargeRate) / PCT_SCALE);
    lines.push({ type: "credit", amount: stagingCredit, surcharge: sc, eftpos: stagingCredit + sc });
  }

  return lines;
}

export function calcPayments(
  docAdj: DocumentAdjustments,
  committedPayments: Payment[],
  stagingCash: number,
  stagingCredit: number,
  surchargeRate: number,
): PaymentCalcResult {
  const allPaymentLines = buildPaymentLines(committedPayments, stagingCash, stagingCredit, surchargeRate);

  const totalCash = allPaymentLines
    .filter((p) => p.type === "cash")
    .reduce((acc, p) => acc + p.amount, 0);
  const totalCredit = allPaymentLines
    .filter((p) => p.type === "credit")
    .reduce((acc, p) => acc + p.amount, 0);
  const totalVoucher = allPaymentLines
    .filter((p) => p.type === "voucher")
    .reduce((acc, p) => acc + p.amount, 0);
  const totalSurcharge = allPaymentLines.reduce((acc, p) => acc + p.surcharge, 0);
  const totalEftpos = totalCredit + totalSurcharge;

  const hasCash = totalCash > 0;
  const effectiveDue = hasCash ? docAdj.roundedDue : docAdj.exactDue;
  const effectiveRounding = hasCash ? docAdj.rounding : 0;

  const remaining = effectiveDue - totalCash - totalCredit - totalVoucher;
  const changeAmount = remaining < 0 ? -remaining : 0;
  const shortAmount = remaining > 0 ? remaining : 0;
  const isShort = remaining > 0;
  const isOverpaid = remaining < 0;
  const canPay = remaining <= 0;

  let appliedPaymentLines = allPaymentLines;
  if (changeAmount > 0) {
    appliedPaymentLines = allPaymentLines.map((p) => ({ ...p }));
    let rem = changeAmount;
    for (let i = appliedPaymentLines.length - 1; i >= 0 && rem > 0; i--) {
      if (appliedPaymentLines[i].type !== "cash") continue;
      const reduction = Math.min(appliedPaymentLines[i].amount, rem);
      appliedPaymentLines[i].amount -= reduction;
      appliedPaymentLines[i].eftpos = appliedPaymentLines[i].amount;
      rem -= reduction;
    }
    appliedPaymentLines = appliedPaymentLines.filter((p) => p.amount > 0);
  }

  return {
    totalCash,
    totalCredit,
    totalVoucher,
    totalSurcharge,
    totalEftpos,
    hasCash,
    effectiveDue,
    effectiveRounding,
    remaining,
    changeAmount,
    shortAmount,
    isShort,
    isOverpaid,
    canPay,
    allPaymentLines,
    appliedPaymentLines,
  };
}

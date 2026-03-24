import { SaleLineType, SaleStoreDiscount } from "../../types/sales";
import { FinalizedLine, TaxCalcResult } from "./types";

export function calcTax(
  lines: SaleLineType[],
  discounts: SaleStoreDiscount[],
  documentDiscountAmount: number,
  totalSurcharge: number,
): TaxCalcResult {
  const lineTotal = lines.reduce((acc, l) => acc + l.total, 0);
  const taxableTotal = lines
    .filter((l) => l.taxable)
    .reduce((acc, l) => acc + l.total, 0);

  if (lineTotal === 0 || taxableTotal === 0) {
    const surchargeTaxAmount = Math.round(totalSurcharge / 11);
    return { goodsTaxAmount: 0, surchargeTaxAmount, taxAmount: surchargeTaxAmount };
  }

  let taxableDiscount = 0;
  for (const disc of discounts) {
    const targets = lines.filter((l) => disc.targetItemIds.includes(l.itemId));
    const targetTaxable = targets.filter((l) => l.taxable);
    const targetTotal = targets.reduce((acc, l) => acc + l.total, 0);
    const targetTaxableTotal = targetTaxable.reduce((acc, l) => acc + l.total, 0);
    if (targetTotal > 0) {
      taxableDiscount += Math.round((disc.amount * targetTaxableTotal) / targetTotal);
    }
  }

  if (documentDiscountAmount > 0 && lineTotal > 0) {
    taxableDiscount += Math.round((documentDiscountAmount * taxableTotal) / lineTotal);
  }

  const taxableDue = taxableTotal - taxableDiscount;
  const goodsTaxAmount = Math.round(taxableDue / 11);
  const surchargeTaxAmount = Math.round(totalSurcharge / 11);
  const taxAmount = goodsTaxAmount + surchargeTaxAmount;

  return { goodsTaxAmount, surchargeTaxAmount, taxAmount };
}

export function allocateDiscountsToLines(
  lines: SaleLineType[],
  discounts: SaleStoreDiscount[],
  documentDiscountAmount: number,
): FinalizedLine[] {
  const lineTotal = lines.reduce((acc, l) => acc + l.total, 0);
  const perLine = new Map<string, number>();
  for (const l of lines) perLine.set(l.lineKey, 0);

  for (const disc of discounts) {
    const targets = lines.filter((l) => disc.targetItemIds.includes(l.itemId));
    const targetTotal = targets.reduce((acc, l) => acc + l.total, 0);
    if (targetTotal === 0) continue;
    distributeProportional(targets, disc.amount, targetTotal, perLine);
  }

  if (documentDiscountAmount > 0 && lineTotal > 0) {
    distributeProportional(lines, documentDiscountAmount, lineTotal, perLine);
  }

  return lines.map((l) => ({
    ...l,
    discount_amount: perLine.get(l.lineKey) ?? 0,
    tax_amount_included: 0,
  }));
}

export function allocateTaxToLines(
  lines: FinalizedLine[],
  goodsTaxAmount: number,
): FinalizedLine[] {
  const taxable = lines.filter((l) => l.taxable);
  const taxableTotal = taxable.reduce((acc, l) => acc + l.total, 0);

  if (taxableTotal === 0 || goodsTaxAmount === 0) {
    return lines.map((l) => ({ ...l, tax_amount_included: 0 }));
  }

  const allocated = largestRemainder(
    taxable.map((l) => l.total),
    taxableTotal,
    goodsTaxAmount,
  );

  const taxMap = new Map<string, number>();
  taxable.forEach((l, i) => taxMap.set(l.lineKey, allocated[i]));

  return lines.map((l) => ({
    ...l,
    tax_amount_included: taxMap.get(l.lineKey) ?? 0,
  }));
}

function distributeProportional(
  targets: SaleLineType[],
  totalAmount: number,
  totalBase: number,
  accumulator: Map<string, number>,
) {
  const allocated = largestRemainder(
    targets.map((l) => l.total),
    totalBase,
    totalAmount,
  );
  targets.forEach((l, i) => {
    accumulator.set(l.lineKey, (accumulator.get(l.lineKey) ?? 0) + allocated[i]);
  });
}

function largestRemainder(
  weights: number[],
  weightTotal: number,
  amountToDistribute: number,
): number[] {
  if (weights.length === 0) return [];

  const precise = weights.map((w) => (amountToDistribute * w) / weightTotal);
  const floored = precise.map((v) => Math.floor(v));
  const remainders = precise.map((v, i) => v - floored[i]);

  let remainder = amountToDistribute - floored.reduce((a, b) => a + b, 0);

  const indices = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r - a.r || a.i - b.i);

  for (let j = 0; j < remainder; j++) {
    floored[indices[j % indices.length].i] += 1;
  }

  return floored;
}

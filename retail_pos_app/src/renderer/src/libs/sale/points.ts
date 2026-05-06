export interface PointLine {
  total: number;
  isPointExcluded: boolean;
}

export interface CalculateSalePointsInput {
  lines: PointLine[];
  linesTotal: number;
  cashApplied: number;
  nonCashBill: number;
  voucherBill: number;
  hasMember: boolean;
  cashPointRate: number;
  otherPointRate: number;
}

export interface SalePointsResult {
  eligiblePointBase: number;
  cashPointBase: number;
  otherPointBase: number;
  pointsEarned: number;
}

export function calculateSalePoints({
  lines,
  linesTotal,
  cashApplied,
  nonCashBill,
  voucherBill,
  hasMember,
  cashPointRate,
  otherPointRate,
}: CalculateSalePointsInput): SalePointsResult {
  const eligiblePointBase = lines.reduce(
    (sum, line) => sum + (line.isPointExcluded ? 0 : line.total),
    0,
  );

  if (!hasMember || eligiblePointBase <= 0 || linesTotal <= 0) {
    return {
      eligiblePointBase: 0,
      cashPointBase: 0,
      otherPointBase: 0,
      pointsEarned: 0,
    };
  }

  const cappedCashApplied = Math.min(Math.max(0, cashApplied), linesTotal);
  const cappedVoucherBill = Math.min(Math.max(0, voucherBill), linesTotal);
  const earningPointBase = Math.round(
    (eligiblePointBase * (linesTotal - cappedVoucherBill)) / linesTotal,
  );
  const cashPointBase =
    nonCashBill <= 0 && cashApplied > 0
      ? eligiblePointBase
      : Math.round((eligiblePointBase * cappedCashApplied) / linesTotal);
  const otherPointBase = Math.max(0, earningPointBase - cashPointBase);
  const pointsEarned =
    Math.round((cashPointBase * cashPointRate) / 1000) +
    Math.round((otherPointBase * otherPointRate) / 1000);

  return {
    eligiblePointBase,
    cashPointBase,
    otherPointBase,
    pointsEarned,
  };
}

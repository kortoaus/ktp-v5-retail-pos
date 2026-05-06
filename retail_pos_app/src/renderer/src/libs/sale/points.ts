export interface PointLine {
  total: number;
  isPointExcluded: boolean;
}

export interface CalculateSalePointsInput {
  lines: PointLine[];
  linesTotal: number;
  cashApplied: number;
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
      eligiblePointBase,
      cashPointBase: 0,
      otherPointBase: 0,
      pointsEarned: 0,
    };
  }

  const cappedCashApplied = Math.min(Math.max(0, cashApplied), linesTotal);
  const cashPointBase = Math.round(
    (eligiblePointBase * cappedCashApplied) / linesTotal,
  );
  const otherPointBase = eligiblePointBase - cashPointBase;
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

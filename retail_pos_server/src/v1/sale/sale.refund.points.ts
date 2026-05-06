interface OriginalPointRow {
  id: number;
  total: number;
  isPointExcluded: boolean;
}

interface RefundPointRow {
  originalInvoiceRowId: number | null;
  total: number;
}

export interface CalculateRefundPointsReversedInput {
  originalPointsEarned: number;
  originalRows: OriginalPointRow[];
  priorRefundRows: RefundPointRow[];
  currentRefundRows: RefundPointRow[];
}

function eligibleRefundBase(
  rows: RefundPointRow[],
  eligibleOriginalRowIds: Set<number>,
): number {
  return rows.reduce((sum, row) => {
    if (row.originalInvoiceRowId == null) return sum;
    if (!eligibleOriginalRowIds.has(row.originalInvoiceRowId)) return sum;
    return sum + Math.max(0, row.total);
  }, 0);
}

function proportionalPoints(
  originalPointsEarned: number,
  eligibleBase: number,
  refundedBase: number,
): number {
  const cappedBase = Math.min(Math.max(0, refundedBase), eligibleBase);
  if (cappedBase <= 0) return 0;
  if (cappedBase >= eligibleBase) return originalPointsEarned;
  return Math.round((originalPointsEarned * cappedBase) / eligibleBase);
}

export function calculateRefundPointsReversed({
  originalPointsEarned,
  originalRows,
  priorRefundRows,
  currentRefundRows,
}: CalculateRefundPointsReversedInput): number {
  if (originalPointsEarned <= 0) return 0;

  const eligibleOriginalRows = originalRows.filter(
    (row) => !row.isPointExcluded && row.total > 0,
  );
  const eligibleBase = eligibleOriginalRows.reduce(
    (sum, row) => sum + row.total,
    0,
  );
  if (eligibleBase <= 0) return 0;

  const eligibleOriginalRowIds = new Set(
    eligibleOriginalRows.map((row) => row.id),
  );
  const priorBase = eligibleRefundBase(
    priorRefundRows,
    eligibleOriginalRowIds,
  );
  const currentBase = eligibleRefundBase(
    currentRefundRows,
    eligibleOriginalRowIds,
  );
  if (currentBase <= 0) return 0;

  const priorPoints = proportionalPoints(
    originalPointsEarned,
    eligibleBase,
    priorBase,
  );
  const totalPoints = proportionalPoints(
    originalPointsEarned,
    eligibleBase,
    priorBase + currentBase,
  );

  return Math.max(0, totalPoints - priorPoints);
}

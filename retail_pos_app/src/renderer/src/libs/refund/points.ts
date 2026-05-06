import type {
  SaleInvoiceDetail,
  SaleInvoiceRowItem,
} from "../../service/sale.service";
import type { RefundSelection } from "./compute";
import { refundRowComputed } from "./compute";

function eligibleOriginalRowIds(rows: SaleInvoiceRowItem[]) {
  return new Set(
    rows
      .filter((row) => !row.isPointExcluded && row.total > 0)
      .map((row) => row.id),
  );
}

function proportionalPoints(
  originalPointsEarned: number,
  eligibleBase: number,
  refundedBase: number,
) {
  const cappedBase = Math.min(Math.max(0, refundedBase), eligibleBase);
  if (cappedBase <= 0) return 0;
  if (cappedBase >= eligibleBase) return originalPointsEarned;
  return Math.round((originalPointsEarned * cappedBase) / eligibleBase);
}

export function calculateExpectedRefundPointsReversed(
  invoice: SaleInvoiceDetail,
  selections: RefundSelection,
) {
  if (invoice.pointsEarned <= 0) return 0;

  const eligibleIds = eligibleOriginalRowIds(invoice.rows);
  const eligibleBase = invoice.rows.reduce((sum, row) => {
    if (!eligibleIds.has(row.id)) return sum;
    return sum + row.total;
  }, 0);
  if (eligibleBase <= 0) return 0;

  let priorBase = 0;
  for (const child of invoice.refunds ?? []) {
    if (child.type !== "REFUND") continue;
    for (const row of child.rows) {
      if (row.originalInvoiceRowId == null) continue;
      if (!eligibleIds.has(row.originalInvoiceRowId)) continue;
      priorBase += Math.max(0, row.total);
    }
  }

  let currentBase = 0;
  for (const row of invoice.rows) {
    const qty = selections[row.id] ?? 0;
    if (qty <= 0 || !eligibleIds.has(row.id)) continue;
    currentBase += refundRowComputed(row, qty, invoice.refunds).product;
  }
  if (currentBase <= 0) return 0;

  const priorPoints = proportionalPoints(
    invoice.pointsEarned,
    eligibleBase,
    priorBase,
  );
  const totalPoints = proportionalPoints(
    invoice.pointsEarned,
    eligibleBase,
    priorBase + currentBase,
  );

  return Math.max(0, totalPoints - priorPoints);
}

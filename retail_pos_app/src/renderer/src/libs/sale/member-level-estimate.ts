import {
  type SaleMember,
  recalculateCartLines,
} from "../../store/SalesStore.helper";
import type { SaleLineType } from "../../types/sales";

const MEMBER_LEVEL_ONE = 1;

export interface MemberLevelOneEstimate {
  currentTotal: number;
  memberTotal: number;
  savings: number;
}

export function getMemberLevelOneEstimate({
  lines,
  member,
}: {
  lines: SaleLineType[];
  member: SaleMember | null;
}): MemberLevelOneEstimate | null {
  if (member != null || lines.length === 0) return null;

  const currentTotal = lines.reduce((sum, line) => sum + line.total, 0);
  if (currentTotal <= 0) return null;

  const estimatedCart = recalculateCartLines(
    { lines, member: null },
    MEMBER_LEVEL_ONE,
  );
  const memberTotal = estimatedCart.lines.reduce(
    (sum, line) => sum + line.total,
    0,
  );
  const savings = currentTotal - memberTotal;

  if (memberTotal <= 0 || savings <= 0) return null;

  return { currentTotal, memberTotal, savings };
}

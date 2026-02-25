import Decimal from "decimal.js";
import { RefundableRow } from "../../types/models";
import { MONEY_DP } from "../../libs/constants";

export interface ClientRefundableRow extends RefundableRow {
  applyQty: number;
}

export const fmt = (d: Decimal) => `$${d.toFixed(MONEY_DP)}`;

import { RefundableRow } from "../../types/models";
import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";

export interface ClientRefundableRow extends RefundableRow {
  applyQty: number;
}

export const fmt = (cents: number) =>
  `$${(Math.abs(cents) / MONEY_SCALE).toFixed(MONEY_DP)}`;

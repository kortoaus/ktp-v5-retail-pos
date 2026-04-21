import { SaleLineType, SaleStoreDiscount } from "../../types/sales";
import { QTY_SCALE } from "../constants";
import { SaleTotals, DocumentAdjustments } from "./types";

export function calcSaleTotals(lines: SaleLineType[]): SaleTotals {
  const lineTotal = lines.reduce((acc, l) => acc + l.total, 0);

  const subTotal = lineTotal;

  const originalTotal = lines.reduce(
    (acc, l) => acc + Math.round((l.unit_price_original * l.qty) / QTY_SCALE),
    0,
  );
  const lineDiscountAmount = originalTotal - subTotal;

  return { lineTotal, subTotal, lineDiscountAmount };
}

export function calcDocumentAdjustments(
  subTotal: number,
  lineDiscountAmount: number,
  method: "percent" | "amount",
  value: number,
): DocumentAdjustments {
  const documentDiscountAmount =
    method === "percent" ? Math.round((subTotal * value) / 100) : value;

  const exactDue = subTotal - documentDiscountAmount;

  const rem = exactDue % 5;
  const roundedDue =
    rem === 0 ? exactDue : exactDue + (rem >= 3 ? 5 - rem : -rem);
  const rounding = roundedDue - exactDue;

  const totalDiscountAmount = lineDiscountAmount + documentDiscountAmount;

  return {
    documentDiscountAmount,
    exactDue,
    roundedDue,
    rounding,
    totalDiscountAmount,
  };
}

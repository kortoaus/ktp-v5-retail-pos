import { SaleLineItem, SaleLineType, SaleStoreDiscount } from "../types/sales";
import { Promotion, PromotionType } from "../types/models";
import { QTY_SCALE, PCT_SCALE } from "../libs/constants";
import { calcMarkdownPrice } from "../libs/pp-barcode";

export interface Cart {
  lines: SaleLineType[];
  member: SaleMember | null;
}

export interface SaleMember {
  id: string;
  name: string;
  level: number;
  phone_last4: string | null;
}

import { PPMarkdown } from "../types/sales";

export interface AddLineOptions {
  qty?: number;
  measured_weight?: number;
  adjustedPrice?: number;
  ppMarkdown?: PPMarkdown | null;
}

export function createEmptyCart(): Cart {
  return { lines: [], member: null };
}

export function resolveOriginalPrice(item: SaleLineItem): number {
  return item.price?.prices[0] ?? 0;
}

export function resolveDiscountedPrice(
  item: SaleLineItem,
  memberLevel: number,
): number | null {
  const original = item.price?.prices[0] ?? 0;
  const levelPrice = item.price?.prices[memberLevel] ?? 0;
  const promoPrice = item.promoPrice?.prices[memberLevel] ?? 0;

  const candidates = [levelPrice, promoPrice].filter(
    (p) => p > 0 && p < original,
  );
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

export function recalculateLine(line: SaleLineType): SaleLineType {
  const unit_price_effective =
    line.unit_price_adjusted ??
    line.unit_price_discounted ??
    line.unit_price_original;
  const total = Math.round((unit_price_effective * line.qty) / QTY_SCALE);
  const tax_amount = line.taxable ? Math.round(total / 11) : 0;
  const subtotal = total - tax_amount;
  return { ...line, unit_price_effective, total, tax_amount, subtotal };
}

export function reindexLines(lines: SaleLineType[]): SaleLineType[] {
  return lines.map((line, i) =>
    line.index === i ? line : { ...line, index: i },
  );
}

export function buildNewLine(
  item: SaleLineItem,
  memberLevel: number,
  index: number,
  options?: AddLineOptions,
): SaleLineType {
  const unit_price_original = resolveOriginalPrice(item);
  const unit_price_discounted = resolveDiscountedPrice(item, memberLevel);
  const qty = options?.qty ?? QTY_SCALE;

  let name_en = item.name_en;
  if (item.type === "weight-prepacked") {
    name_en = `${name_en} (Prepacked)`;
  }

  const line: SaleLineType = {
    ...item,
    name_en,
    lineKey: crypto.randomUUID(),
    index,
    original_invoice_id: null,
    original_invoice_row_id: null,
    barcode_price: null,
    unit_price_adjusted: options?.adjustedPrice ?? null,
    unit_price_discounted,
    unit_price_original,
    unit_price_effective: 0,
    qty,
    measured_weight: options?.measured_weight ?? null,
    total: 0,
    tax_amount: 0,
    subtotal: 0,
    adjustments: options?.adjustedPrice != null ? ["PRICE_OVERRIDE"] : [],
    ppMarkdown: options?.ppMarkdown ?? null,
  };

  return recalculateLine(line);
}

export function findMergeTarget(
  lines: SaleLineType[],
  item: SaleLineItem,
  memberLevel: number,
): number {
  const unit_price_original = resolveOriginalPrice(item);
  const unit_price_discounted = resolveDiscountedPrice(item, memberLevel);

  return lines.findIndex(
    (l) =>
      l.type === "normal" &&
      l.itemId === item.itemId &&
      l.unit_price_adjusted === null &&
      l.unit_price_discounted === unit_price_discounted &&
      l.unit_price_original === unit_price_original,
  );
}

export function recalculateAllLines(
  carts: Cart[],
  memberLevel: number,
): Cart[] {
  return carts.map((cart) => ({
    lines: cart.lines.map((line) => {
      if (line.unit_price_adjusted != null && !line.ppMarkdown) return line;

      const unit_price_discounted = resolveDiscountedPrice(line, memberLevel);
      const effective = unit_price_discounted ?? line.unit_price_original;

      if (line.ppMarkdown) {
        const adjusted = calcMarkdownPrice(
          effective,
          line.ppMarkdown.discountType,
          line.ppMarkdown.discountAmount,
        );
        return recalculateLine({
          ...line,
          unit_price_discounted,
          unit_price_adjusted: adjusted,
        });
      }

      return recalculateLine({ ...line, unit_price_discounted });
    }),
    member: cart.member,
  }));
}

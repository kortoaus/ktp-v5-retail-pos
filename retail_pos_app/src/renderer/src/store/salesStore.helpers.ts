import { SaleLineItem, SaleLineType, SaleStoreDiscount } from "../types/sales";
import { Decimal } from "decimal.js";
import { MONEY_DP, QTY_DP } from "../libs/constants";
import { Promotion, PromotionType } from "../types/models";

export interface Cart {
  lines: SaleLineType[];
  discounts: SaleStoreDiscount[];
  member: SaleMember | null;
}

export interface SaleMember {
  id: string;
  name: string;
  level: number;
  phone_last4: string | null;
}

export interface AddLineOptions {
  prepackedPrice?: number;
  qty?: number;
  measured_weight?: number;
}

export function createEmptyCart(): Cart {
  return { lines: [], discounts: [], member: null };
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
  const total = new Decimal(unit_price_effective)
    .mul(line.qty)
    .toDecimalPlaces(MONEY_DP)
    .toNumber();
  const tax_amount = line.taxable
    ? new Decimal(total).div(11).toDecimalPlaces(MONEY_DP).toNumber()
    : 0;
  const subtotal = new Decimal(total)
    .sub(tax_amount)
    .toDecimalPlaces(MONEY_DP)
    .toNumber();
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
  const prepackedPrice = options?.prepackedPrice;
  const isPrepacked =
    item.type === "prepacked" || item.type === "weight-prepacked";
  const defaultPrice = item.price?.prices[0] ?? 0;
  const isSupplierPrepacked = isPrepacked && defaultPrice <= 0;

  let unit_price_original: number;
  let unit_price_discounted: number | null;
  let qty: number;

  if (isPrepacked && prepackedPrice != null) {
    if (isSupplierPrepacked) {
      unit_price_original = prepackedPrice;
      unit_price_discounted = null;
      qty = 1;
    } else {
      unit_price_original = defaultPrice;
      unit_price_discounted = resolveDiscountedPrice(item, memberLevel);
      console.log(item.type, prepackedPrice, defaultPrice);
      qty = new Decimal(prepackedPrice)
        .div(defaultPrice)
        .toDecimalPlaces(QTY_DP)
        .toNumber();
    }
  } else {
    unit_price_original = resolveOriginalPrice(item);
    unit_price_discounted = resolveDiscountedPrice(item, memberLevel);
    qty = options?.qty ?? 1;
  }

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
    barcode_price:
      isPrepacked && prepackedPrice != null ? prepackedPrice : null,
    unit_price_adjusted: null,
    unit_price_discounted,
    unit_price_original,
    unit_price_effective: 0,
    qty,
    measured_weight: options?.measured_weight ?? null,
    total: 0,
    tax_amount: 0,
    subtotal: 0,
    adjustments: [],
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
      const isPrepacked =
        line.type === "prepacked" || line.type === "weight-prepacked";
      const defaultPrice = line.price?.prices[0] ?? 0;

      if (isPrepacked && line.barcode_price != null && defaultPrice <= 0) {
        return line;
      }

      const unit_price_discounted = resolveDiscountedPrice(line, memberLevel);
      return recalculateLine({ ...line, unit_price_discounted });
    }),
    member: cart.member,
    discounts: cart.discounts,
  }));
}

export function applyPromotions(
  lines: SaleLineType[],
  promotions: Promotion[],
): SaleStoreDiscount[] {
  const discounts: SaleStoreDiscount[] = [];
  const pureLines = lines.filter((line) => line.unit_price_adjusted === null);

  for (const promotion of promotions) {
    const type = promotion.type;
    switch (type) {
      case PromotionType.BUY_MORE_SAVE_MORE:
        const discount = applyBuyMoreSaveMorePromotion(pureLines, promotion);
        if (discount) {
          discounts.push(discount);
        }
        break;
    }
  }

  return discounts;
}

export function applyBuyMoreSaveMorePromotion(
  lines: SaleLineType[],
  promotion: Promotion,
): SaleStoreDiscount | null {
  console.log("applyBuyMoreSaveMorePromotion", promotion);
  console.log("lines", lines);
  const { allowedItemIds, requiredItemIds, discountType, discountAmounts } =
    promotion;
  const minQty = new Decimal(promotion.minQty);
  const maxQty = promotion.maxQty ? new Decimal(promotion.maxQty) : null;
  const targetLines = lines.filter((line) =>
    allowedItemIds.includes(line.itemId),
  );
  const itemPool = [...new Set(targetLines.map((line) => line.itemId))];

  // must exist all required items in target lines
  if (
    requiredItemIds.length > 0 &&
    requiredItemIds.some((id) => !itemPool.includes(id))
  ) {
    return null;
  }

  const totalQty = targetLines.reduce(
    (acc, line) => acc.add(new Decimal(line.qty)),
    new Decimal(0),
  );
  const totalPrice = targetLines.reduce(
    (acc, line) => acc.add(new Decimal(line.total)),
    new Decimal(0),
  );

  if (totalQty.lt(minQty)) {
    return null;
  }

  let cappedQty = totalQty;
  if (maxQty && cappedQty.gt(maxQty)) {
    cappedQty = maxQty;
  }

  const discountAmount =
    discountType === "percentage"
      ? totalPrice.mul(discountAmounts[0] / 100)
      : discountAmounts[0];
  const dcmAmount = new Decimal(discountAmount);
  const appliedAmount = dcmAmount
    .mul(cappedQty)
    .div(totalQty)
    .toDecimalPlaces(MONEY_DP)
    .toNumber();

  const description = targetLines.map((line) => line.name_en).join(", ");

  return {
    lineKey: null,
    entityType: "promotion",
    entityId: promotion.id,
    title: promotion.name_en,
    description,
    amount: appliedAmount,
  };
}

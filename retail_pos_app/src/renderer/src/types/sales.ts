import { ItemTypes } from "../libs/item-utils";
import { Price, PromoPrice } from "./models";

export interface SaleLineItem {
  type: ItemTypes;
  itemId: number;
  name_en: string;
  name_ko: string;
  price: Price | null;
  promoPrice: PromoPrice | null;
  taxable: boolean;
  uom: string;
  barcode: string;
}

export type LineAdjustment =
  | "PRICE_OVERRIDE"
  | "QTY_OVERRIDE"
  | "DISCOUNT_OVERRIDE";

export interface SaleLineType extends SaleLineItem {
  original_receipt_id: number | null;
  original_receipt_line_id: number | null;
  lineKey: string;
  index: number;
  barcode_price: number | null; // original barcode-embedded price (prepacked/weight-prepacked only)
  unit_price_adjusted: number | null; // user injected price priority:0
  unit_price_discounted: number | null; // from promo price priority:1
  unit_price_original: number; // from price priority:2
  unit_price_effective: number; // resolved: adjusted ?? discounted ?? original
  qty: number;
  measured_weight: number | null;
  total: number; // effective unit price * qty
  tax_amount: number; // price is tax included, must be calculated from price and tax_rate
  subtotal: number; // total - tax_amount
  adjustments: LineAdjustment[];
}

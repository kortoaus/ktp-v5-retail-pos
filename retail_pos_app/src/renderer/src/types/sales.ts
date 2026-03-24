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

export interface PPMarkdown {
  discountType: "pct" | "amt";
  discountAmount: number;
}

export interface SaleLineType extends SaleLineItem {
  original_invoice_id: number | null;
  original_invoice_row_id: number | null;
  lineKey: string;
  index: number;
  barcode_price: number | null;
  unit_price_adjusted: number | null;
  unit_price_discounted: number | null;
  unit_price_original: number;
  unit_price_effective: number;
  qty: number;
  measured_weight: number | null;
  total: number;
  tax_amount: number;
  subtotal: number;
  adjustments: LineAdjustment[];
  ppMarkdown: PPMarkdown | null;
}

export interface SaleStoreDiscount {
  lineKey: string | null;
  entityType: "promotion";
  entityId: number;
  title: string;
  description: string;
  amount: number;
  targetItemIds: number[];
}

import { ItemTypes } from "../libs/item-utils";
import { Price, PromoPrice } from "./models";

/**
 * SaleLineItem — the item-level snapshot produced at scan time, BEFORE it
 * becomes a cart line. `generateSaleLineItem` in libs/item-utils.ts builds
 * this from a master `Item` record + the raw barcode that was scanned.
 *
 * All fields here are SNAPSHOTS. Once captured they must not be mutated by
 * later master-data changes — a reprint six months from now must still show
 * the same name / price / tax status that the customer actually paid.
 */
export interface SaleLineItem {
  /**
   * Item classification driving the line's behaviour in the cart:
   *   "normal"            — fixed-price SKU, qty is editable, merges with
   *                         other identical lines.
   *   "prepacked"         — fixed-price SKU scanned via an EAN-13 that
   *                         embeds a price. Qty locked, immutable once added.
   *   "weight"            — open-weight deli/produce item. Qty is the weight
   *                         (in QTY_SCALE units) read from the scale.
   *   "weight-prepacked"  — prepacked weight item (packaged deli/fruit with
   *                         PP barcode). Qty locked to the printed weight.
   *   "invalid"           — barcode parsed but item could not be resolved;
   *                         the cart refuses to add it.
   */
  type: ItemTypes;

  /** Foreign key to Item in the master catalogue. */
  itemId: number;

  /** English display name at scan time. Snapshot. */
  name_en: string;

  /** Korean display name at scan time. Snapshot. */
  name_ko: string;

  /**
   * Level-indexed price list (`price.prices[0]` is the public / level-0
   * price, `price.prices[N]` is the member-level-N price). `null` when the
   * item has no price record — the cart treats this as free / $0.
   */
  price: Price | null;

  /**
   * Optional promotional price record with a validity window. Same
   * level-indexed shape as `price`. When present AND currently valid, its
   * level-N price participates in `unit_price_discounted` resolution.
   */
  promoPrice: PromoPrice | null;

  /**
   * GST flag snapshotted at scan time. AU GST is 10% inclusive, so
   * `tax_amount = round(total / 11)` when `taxable === true`, else 0.
   * Flipping the master item's taxability later does NOT retroactively
   * change existing lines.
   */
  taxable: boolean;

  /** Unit of measure string ("ea", "kg", "pk", etc.). Display-only today. */
  uom: string;

  /** The raw barcode that produced this line (GTIN, PLU, or embedded). */
  barcode: string;
}

/**
 * Tags attached to a cart line to record what kind of manual or rule-based
 * adjustment was applied. Intended to flow into `SaleInvoiceRow` at sale
 * time so receipts and audit reports can explain WHY the price moved.
 *
 * Today only `PRICE_OVERRIDE` is ever written — the discount-$, discount-%,
 * and "Override Price" modals all funnel through `injectLinePrice`, which
 * sets `unit_price_adjusted` and appends this single tag.
 *
 * `QTY_OVERRIDE` and `DISCOUNT_OVERRIDE` are declared but currently dead.
 * They are intentionally reserved for future use (audit-trail refactor —
 * distinguish "cashier changed qty" vs "cashier keyed a $ discount" vs
 * "cashier forced a raw price") and will likely be expanded into a
 * structured `{type, reason?, authorizedByUserId?}` shape.
 */
export type LineAdjustment =
  | "PRICE_OVERRIDE"
  | "QTY_OVERRIDE"
  | "DISCOUNT_OVERRIDE";

/**
 * PPMarkdown — markdown metadata parsed from a Prepacked ("PP") barcode.
 *
 * PP barcodes embed a discount instruction alongside the item reference so
 * that stickered clearance stock (e.g. "20% OFF") scans correctly without
 * requiring a separate cashier action. The parser lives in
 * `libs/pp-barcode.ts`. The resulting discount is baked into the line's
 * `unit_price_adjusted` at add-time, but this metadata is ALSO stored on
 * the line so that member-level changes can re-apply the markdown on top
 * of the newly discounted base price (see `recalculateCartLines`).
 */
export interface PPMarkdown {
  /**
   * "pct" — percentage markdown; `discountAmount` is tenths of a percent
   *         (e.g. 250 = 25.0%).
   * "amt" — fixed-amount markdown; `discountAmount` is cents off.
   */
  discountType: "pct" | "amt";

  /** Magnitude of the markdown — interpretation depends on `discountType`. */
  discountAmount: number;
}

/**
 * SaleLineType — a single line in a cart. Extends the item snapshot
 * (`SaleLineItem`) with pricing, quantity, tax, and bookkeeping fields.
 *
 * Money units: all `*_price*`, `total`, `tax_amount`, and `net` values are
 * integer cents (MONEY_SCALE = 100). Never use raw floats.
 *
 * Quantity units: `qty` and `measured_weight` are integer thousandths
 * (QTY_SCALE = 1000). 1000 = one unit / one kilogram.
 *
 * Write invariant: the fields `unit_price_effective`, `total`, `tax_amount`
 * and `net` are DERIVED. They must only be assigned by `recalculateLine`
 * in SalesStore.helper.ts. Never set them directly from components.
 *
 * Refund lineage: when this line represents a refund row (produced from
 * an existing invoice), `original_invoice_id` and `original_invoice_row_id`
 * point back to the source. On new sales both are `null`.
 */
export interface SaleLineType extends SaleLineItem {
  /**
   * If this line is a refund, the SaleInvoice it refunds from. `null`
   * otherwise. Used by refund validation (cap check against refundable qty)
   * and by receipt rendering ("Refund of INV-1234").
   */
  original_invoice_id: number | null;

  /**
   * If this line is a refund, the specific SaleInvoiceRow it refunds from.
   * `null` otherwise. Enables partial-qty refunds and prevents double
   * refunding the same row.
   */
  original_invoice_row_id: number | null;

  /**
   * Client-only React key (UUID v4, generated by `crypto.randomUUID()`).
   * Stable across re-renders for the lifetime of the line. NOT persisted
   * to the DB — `SaleInvoiceRow` has its own server-assigned id.
   */
  lineKey: string;

  /**
   * Display position within the cart (0-based). Maintained by
   * `reindexLines` after every mutation that changes array order. Duplicate
   * of array index; kept as a field purely so paginated rendering can use
   * the natural row number without prop drilling.
   */
  index: number;

  /**
   * Manually overridden unit price in cents, or `null` when no override is
   * active. Set by the "Override Price", "Discount $", "Discount %" modals
   * (all via `injectLinePrice`) and by PP-barcode markdown at add-time.
   * Highest-precedence input to `unit_price_effective`.
   */
  unit_price_adjusted: number | null;

  /**
   * Best automatic discount that beats `unit_price_original`, in cents, or
   * `null` when no level/promo price improves on the original. Computed by
   * `resolveDiscountedPrice` as `min({level_price, promo_price})` filtered
   * to values strictly less than `unit_price_original`. Re-evaluated when
   * the cart's member changes.
   */
  unit_price_discounted: number | null;

  /**
   * Public list price captured at scan time, in cents. Snapshot — does not
   * change even if master pricing is updated mid-session. Source of truth
   * for the "was" price struck through on the receipt.
   */
  unit_price_original: number;

  /**
   * The unit price the customer is actually being charged, in cents.
   * Derived: `unit_price_adjusted ?? unit_price_discounted ?? unit_price_original`.
   * Drives `total`. Written only by `recalculateLine`.
   */
  unit_price_effective: number;

  /**
   * Line quantity in QTY_SCALE units (×1000). For `"normal"` items this is
   * a whole-number multiple of 1000. For `"weight"` items it is the
   * measured weight in grams-equivalent scaled units. For `"prepacked"`
   * and `"weight-prepacked"` items it is locked at add-time and cannot be
   * changed (see ALLOWED_CHANGE_QTY_TYPES).
   */
  qty: number;

  /**
   * Gross weight reading from the scale, in QTY_SCALE units, for weight
   * and weight-prepacked lines. `null` for normal and prepacked. Display
   * purpose only today (receipt shows "{measured_weight} kg × $/kg").
   * Tare is NOT yet modelled — any deli/meat flow that needs net weight
   * will require adding `{gross, tare, net}` here.
   */
  measured_weight: number | null;

  /**
   * Tax-INCLUSIVE line total, in cents.
   * Formula: `round(unit_price_effective × qty / QTY_SCALE)`.
   * This is the number printed on the receipt for the line, summed into
   * the invoice's `linesTotal`, and persisted as `SaleInvoiceRow.total`.
   * Written only by `recalculateLine`.
   */
  total: number;

  /**
   * GST portion of `total`, in cents. `round(total / 11)` when `taxable`,
   * else 0. AU GST is 10% inclusive, hence /11 (not /10).
   * Summed per-line to produce the invoice's tax line — invoice tax is
   * `Σ line.tax_amount`, NOT `round(Σ line.net × 0.1)`, to avoid cumulative
   * 1-cent drift. Written only by `recalculateLine`.
   */
  tax_amount: number;

  /**
   * Tax-EXCLUSIVE line total, in cents. `total - tax_amount`.
   * Display-only aggregate (DocumentMonitor's "NET" cell). Redundant with
   * `total` and `tax_amount`; retained for readability. May be dropped in
   * a future simplification pass. Written only by `recalculateLine`.
   */
  net: number;

  /**
   * Audit tags describing how this line's price arrived at its current
   * value. See `LineAdjustment` above. Appended to by `injectLinePrice`
   * and `buildNewLine`. Clearing the override (price → null) removes the
   * corresponding tag.
   */
  adjustments: LineAdjustment[];

  /**
   * Prepacked-barcode markdown metadata, or `null` if the line did not
   * come from a PP barcode. Used by `recalculateCartLines` to re-apply
   * the markdown on top of the new discounted base when the member level
   * changes. See `PPMarkdown` above.
   */
  ppMarkdown: PPMarkdown | null;
}

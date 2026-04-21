export type BarcodeType = "RAW" | "GTIN" | "PLU" | "UPC" | "EAN";

export type ItemRFD = "R" | "F" | "D";

export interface Company {
  id: number;
  cloudId: number;
  name: string;
  phone?: string;
  address1: string;
  address2?: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  abn?: string;
  website?: string;
  email?: string;
}

export interface Category {
  id: number;
  name_en: string;
  name_ko: string;
  parentId: number | null;
  index: number;
  level: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  companyId: number;
  children?: Category[];
}

export interface Brand {
  id: number;
  name_en: string;
  name_ko: string;
  archived: boolean;
  companyId: number;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
}

export interface ItemScaleData {
  itemId: number;
  fixedWeightString: string | null;
  usedBy: number;
  isFixedWeight: boolean;
  ingredients: string | null;
}

export interface ItemCategory {
  itemId: number;
  categoryId: number;
}

export interface Item {
  id: number;
  companyId: number;
  name_en: string;
  name_ko: string;
  name_invoice: string | null;
  barcode: string;
  code: string | null;
  thumb: string | null;
  barcodeGTIN: string | null;
  barcodePLU: string | null;
  barcodeType: string;
  uom: string;
  defaultRFD: ItemRFD;
  isScale: boolean;
  isBundle: boolean;
  useBatch: boolean;
  archived: boolean;
  bundleQty: number;
  parentId: number | null;
  brandId: number | null;
  brand: Brand | null;
  categoryIds: number[];
  categoryMarks: string[];
  taxable: boolean;
  wholesaleTaxable: boolean;
  scaleData: ItemScaleData | null;
  createdAt: string;
  updatedAt: string;
  isTemporary: boolean;
  price: Price | null;
  promoPrice: PromoPrice | null;
}

export interface CloudHotkey {
  id: number;
  companyId: number;
  sort: number;
  name_en: string;
  name_ko: string;
  keys: CloudHotkeyItem[];
  color: string; // e.g. "bg-gray-100 text-black"
  archived: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface CloudHotkeyItem {
  id: number;
  companyId: number;
  hotkeyId: number;
  hotkey: CloudHotkey;
  x: number;
  y: number;
  itemId: number;
  color: string; // e.g. "bg-gray-100 text-black"
  page: number;
  item: Item;
}

export interface Price {
  id: number;
  companyId: number;
  itemId: number;
  priceType: string;
  prices: number[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  markup: number;
}

export interface PromoPrice {
  id: number;
  companyId: number;
  itemId: number;
  priceType: string;
  prices: number[];
  validFrom: string;
  validTo: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  name_en: string;
  name_ko: string;
}

export interface Staff {
  id: number;
  code: string;
  name: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Hotkey {
  id: number;
  sort: number;
  name: string;
  keys: HotkeyItem[];
  color: string;
}

export interface HotkeyItem {
  id: number;
  hotkeyId: number;
  hotkey: Hotkey;
  x: number;
  y: number;
  itemId: number;
  item: Item;
  name: string;
  color: string;
}

export interface Member {
  id: string;
  companyId: number;
  phone_last4: string | null;
  name: string;
  email: string | null;
  dob: string | null;
  gender: string;
  cash_spend: number;
  credit_spend: number;
  points: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastLogin?: string;
  level: number;
}
export interface User {
  id: number;
  name: string;
  code: string;
  scope: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface UserVoucher {
  id: number;
  userId: number;
  user: User;
  init_amount: number;
  left_amount: number;
  validFrom: string;
  validTo: string;
  issuedById: number;
  issuedByName: string;
  createdAt: string;
}

export interface TerminalShift {
  id: number;
  companyId: number;
  terminalId: number;
  // date meta
  dayStr: string;

  // staff data
  openedUserId: number;
  openedUser: string;
  openedAt: string;
  openedNote?: string | null;
  closedUserId?: number | null;
  closedUser?: string | null;
  closedAt?: string | null;
  closedNote?: string | null;

  // Money in Drawer
  startedCach: number;
  endedCashExpected: number;
  endedCashActual: number;

  // Sales
  salesCash: number;
  salesCredit: number;
  salesVoucher: number;
  salesTax: number;

  // Refunds
  refundsCash: number;
  refundsCredit: number;
  refundsVoucher: number;
  refundsTax: number;

  // Cash In/Out
  cashIn: number;
  cashOut: number;
  totalCashIn: number;
  totalCashOut: number;
  // Cloud Sync
  syncedAt?: string | null;
  synced: boolean;
}

export const SCOPES = [
  "admin",
  "sale",
  "interface",
  "user",
  "hotkey",
  "refund",
  "cashio",
  "store",
  "shift",
];

export interface OnPaymentPayload {
  subtotal: number; // Σ line.total
  documentDiscountAmount: number; // manual discount entered at payment (cents)
  creditSurchargeAmount: number; // 1.5% surcharge on credit payment
  rounding: number; // 5c rounding adjustment (+/-)
  total: number; // sale amount = subtotal - discount + rounding (excludes surcharge)
  taxAmount: number; // GST extracted (inclusive ÷ 11)
  cashPaid: number; // cash applied to bill (received - change)
  cashChange: number; // change given back to customer
  creditPaid: number; // base card charge (excludes surcharge)
  totalDiscountAmount: number; // line discounts + document discount ("You Saved")
  payments: { type: string; amount: number; surcharge: number }[];
}

export interface Terminal {
  id: number;
  name: string;
  ipAddress: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── SaleInvoiceRow ─────────────────────────────────────────
// All prices: Int cents (×100). qty/weight: Int (×1000).
// Tax is INCLUDED in all prices — Australian GST model.
// total = unit_price_effective × qty / QTY_SCALE (tax-inclusive)
// tax_amount_included = extracted from total (total / 11 for 10% GST)
// subtotal = total - tax_amount_included
// discount_amount = allocated share of the manual document discount (cents)
//   → used in refund: net_total = total - discount_amount
export interface SaleInvoiceRow {
  id: number;
  invoiceId: number;
  type: string;
  itemId: number;
  name_en: string;
  name_ko: string;
  taxable: boolean;
  uom: string;
  barcode: string;
  index: number;
  barcodePrice: number | null;
  unit_price_original: number; // base price (cents, tax-incl)
  unit_price_discounted: number | null; // member/promo level price (cents, tax-incl)
  unit_price_adjusted: number | null; // manual override or markdown (cents, tax-incl)
  unit_price_effective: number; // resolved: adjusted ?? discounted ?? original
  qty: number; // ×1000 (1ea = 1000, 1.234kg = 1234)
  measured_weight: number | null; // ×1000 (weight items only)
  subtotal: number; // total - tax_amount_included (cents) — NOT same as SaleInvoice.subtotal
  total: number; // effective × qty / QTY_SCALE (cents, tax-incl)
  tax_amount_included: number; // GST extracted from total (cents) — display/reporting only
  discount_amount: number; // allocated manual document discount (cents)
  original_invoice_id: number | null;
  original_invoice_row_id: number | null;
  refunded: boolean;
  adjustments: string[];
  createdAt: string;
}

// ─── SaleInvoicePayment ─────────────────────────────────────
// amount: what the customer paid via this method (cents)
// surcharge: credit card surcharge added on top (cents)
// actual EFTPOS charge = amount + surcharge
export interface SaleInvoicePayment {
  id: number;
  invoiceId: number;
  type: string; // "cash" | "credit" | "voucher"
  amount: number; // cents — payment toward the due amount
  surcharge: number; // cents — credit surcharge (0 for cash/voucher)
  createdAt: string;
  entityType: string | null; // "user-voucher" for voucher payments
  entityId: number | null; // voucher ID
  updatedAt: string;
}

// ─── SaleInvoice ────────────────────────────────────────────
// All money fields: Int cents (×100). Tax-inclusive pricing model.
//
// subtotal = Σ(row.total)
//   → NOT the same as SaleInvoiceRow.subtotal (that's row.total - row.tax)
// documentDiscountAmount = manual discount entered at payment (cents)
// total = subtotal - documentDiscountAmount + rounding + creditSurchargeAmount
//   → what the customer ACTUALLY pays (includes surcharge)
//   → = Σ(payment.amount + payment.surcharge)
// taxAmount = goodsTax + surchargeTax (extracted, for reporting)
// totalDiscountAmount = lineDiscount + documentDiscount (영수증 "You Saved")
//   → lineDiscount = Σ(original × qty / QTY_SCALE) - subtotal
//   → includes member/item-level promo prices, price overrides, PP markdowns, manual discount
export interface SaleInvoice {
  id: number;
  type: string; // "sale" | "refund"
  serialNumber: string | null;
  original_invoice_id: number | null; // refund only — parent sale invoice
  original_invoice_serialNumber: string | null;
  companyId: number;
  companyName: string;
  abn: string | null;
  address1: string | null;
  address2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  memberId: string | null;
  memberLevel: number | null;
  terminalId: number;
  terminal: Terminal;
  shiftId: number;
  userId: number;
  issuedAt: string;
  createdAt: string;
  updatedAt: string;
  rows: SaleInvoiceRow[];
  subtotal: number; // cents — after promo, before manual discount
  documentDiscountAmount: number; // cents — manual discount at payment
  creditSurchargeAmount: number; // cents — Σ(credit surcharge)
  rounding: number; // cents — 5c cash rounding (0 if no cash)
  total: number; // cents — customer pays (subtotal - docDiscount + rounding + surcharge)
  taxAmount: number; // cents — extracted GST (goods + surcharge), reporting only
  cashPaid: number; // cents — net cash (received - change)
  cashChange: number; // cents — change given back
  creditPaid: number; // cents — credit card amount (excl surcharge)
  voucherPaid: number; // cents — voucher amount
  totalDiscountAmount: number; // cents — total savings shown on receipt
  payments: SaleInvoicePayment[];
}

export interface RefundableRow extends SaleInvoiceRow {
  remainingQty: number;
  remainingTotal: number;
  remainingIncludedTaxAmount: number;
}

export interface RefundableVoucherCap {
  entityType: string | null;
  entityId: number | null;
  originalAmount: number;
  remainingAmount: number;
}

export interface RefundableInvoice extends Omit<SaleInvoice, "rows"> {
  rows: RefundableRow[];
  refundedInvoices: SaleInvoice[];
  remainingCash: number;
  remainingCredit: number;
  remainingVoucher: number;
  remainingVouchers: RefundableVoucherCap[];
}

export interface CashInOut {
  id: number;
  shiftId: number;
  terminalId: number;
  userId: number;
  userName: string;
  type: string;
  amount: number;
  note?: string | null;
  createdAt: string;
}

export interface StoreSetting {
  id: number;
  name: string;
  phone?: string | null;
  address1: string;
  address2?: string | null;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  abn?: string | null;
  website?: string | null;
  email?: string | null;
  credit_surcharge_rate?: number | null;
  receipt_below_text?: string | null;
  user_daily_voucher_default?: number | null;
}

export interface CloudPost {
  id: number;
  companyId: number;
  status: string;
  category: string;
  titleEn: string;
  titleKo: string;
  descEn: string | null;
  descKo: string | null;
  imgId: string;
  content: CloudPostContentType;
  createdAt: string;
  updatedAt: string;
}

export interface CloudPostContentType {
  type: string;
  attrs?: Record<string, any>;
  content?: CloudPostContentType[];
  marks?: { type: string; attrs?: Record<string, any> }[];
  text?: string;
}

export enum PromotionType {
  BUY_MORE_SAVE_MORE = "BUY_MORE_SAVE_MORE", // eg. 2 for $5
  MIX_AND_SAVE = "MIX_AND_SAVE", // eg. if A($7)+B($7) for $5 each
  N_FOR_N_MINUS_ONE = "N_FOR_N_MINUS_ONE", // eg buy 3 get 1 free
}

export interface Promotion {
  id: number;
  type: PromotionType;
  companyId: number;
  name_en: string;
  name_ko: string;
  desc_en?: string | null;
  desc_ko?: string | null;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  archived: boolean;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string

  requiredItemIds: number[];
  allowedItemIds: number[];

  minQty: number; // default: 1
  maxQty?: number | null; // optional

  discountType: "percentage" | "amount";
  discountAmounts: number[];
  discountPercents: number[];
}

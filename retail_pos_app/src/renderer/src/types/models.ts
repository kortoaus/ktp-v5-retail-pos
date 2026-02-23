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
  totalCashIn: number;
  totalCashOut: number;

  // Cloud Sync
  syncedAt?: string | null;
  synced: boolean;
}

export const SCOPES = ["admin", "interface", "user", "hotkey"];

export interface OnPaymentPayload {
  subtotal: number; // Σ line.total
  documentDiscountAmount: number; // document-level discount applied
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

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

export interface Terminal {
  id: number;
  name: string;
  ipAddress: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
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

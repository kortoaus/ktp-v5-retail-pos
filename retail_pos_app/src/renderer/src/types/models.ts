export type BarcodeType = "RAW" | "GTIN" | "PLU" | "UPC" | "EAN";

export type ItemRFD = "R" | "F" | "D";

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

export const LABEL_7090_WIDTH = 560;
export const LABEL_7090_HEIGHT = 720;
export const LABEL_7090_SLCS_SLICE_HEIGHT = 256;
export const LABEL_7090_BLACK_THRESHOLD = 220;
export const DATAMATRIX_SIZE_PX = 60;

export type PriceTag7090Case =
  | "normal-guest"
  | "normal-member"
  | "promo-guest"
  | "promo-member";

export interface PriceDisplay {
  label: "GUEST" | "MEMBER";
  priceCents: number;
  saveCents: number;
}

export type PriceTag7090PriceMode = "current" | "normal";

export interface PriceTag7090BuildOptions {
  priceMode?: PriceTag7090PriceMode;
  storeName?: string | null;
}

export interface PriceTag7090Model {
  caseName: PriceTag7090Case;
  headline: string;
  barcode: string;
  barcodeText: string;
  code: string | null;
  nameKo: string;
  nameEn: string;
  uom: string;
  baseGuestCents: number;
  guest: PriceDisplay;
  member: PriceDisplay | null;
  promoNameKo: string | null;
  promoNameEn: string | null;
  promoDateRange: string | null;
}

export interface MonoRaster {
  width: number;
  height: number;
  widthBytes: number;
  data: Uint8Array;
}

// Server-side mirror of the client payload shape
// (retail_pos_app/src/renderer/src/libs/sale/payload.types.ts).
// Keep in sync manually — no monorepo sharing.

export type RowTypeWire =
  | "NORMAL"
  | "PREPACKED"
  | "WEIGHT"
  | "WEIGHT_PREPACKED";

export type PaymentTypeWire = "CASH" | "CREDIT" | "VOUCHER" | "GIFTCARD";

export type LineAdjustmentWire = "PRICE_OVERRIDE";

export interface MemberSnapshotPayload {
  id: string;
  name: string;
  level: number;
  phoneLast4: string | null;
}

export interface SaleRowPayload {
  index: number;
  type: RowTypeWire;
  itemId: number;
  name_en: string;
  name_ko: string;
  barcode: string;
  uom: string;
  taxable: boolean;
  unit_price_original: number;
  unit_price_discounted: number | null;
  unit_price_adjusted: number | null;
  unit_price_effective: number;
  qty: number;
  measured_weight: number | null;
  total: number;
  tax_amount: number;
  net: number;
  adjustments: LineAdjustmentWire[];
  ppMarkdownType: "pct" | "amt" | null;
  ppMarkdownAmount: number | null;
}

export interface PaymentPayload {
  type: PaymentTypeWire;
  amount: number;
  entityType?: "user-voucher" | "customer-voucher";
  entityId?: number;
  entityLabel?: string;
}

// SALE 과 SPEND 모두 같은 shape 으로 받음. 서버가 분기 처리.
// SPEND 의 경우: 금액 전부 0, payments 빈 배열, member null 기대 (서버가 강제).
export interface SaleCreatePayload {
  type: "SALE" | "SPEND";
  member: MemberSnapshotPayload | null;
  linesTotal: number;
  rounding: number;
  creditSurchargeAmount: number;
  lineTax: number;
  surchargeTax: number;
  total: number;
  cashChange: number;
  rows: SaleRowPayload[];
  payments: PaymentPayload[];
  note?: string;
}

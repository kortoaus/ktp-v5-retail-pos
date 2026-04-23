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

// ── REFUND payload ─────────────────────────────────────────────
// Refund 의도만 받음. 서버가 D-26 분리 저장 + drift-absorbing 수식으로
// refund_row.total / surcharge_share / tax / invoice 합계 / rounding / serial
// 전부 canonical 재계산 (sale.refund.service.ts 헤더 주석 참조).
export interface RefundRowPayload {
  originalInvoiceRowId: number; // 원본 SALE row.id
  refund_qty: number; // ×1000 (QTY_SCALE)
}

export interface RefundCreatePayload {
  originalInvoiceId: number;
  rows: RefundRowPayload[];
  payments: PaymentPayload[];
  note?: string;
}

// ── REPAY payload ─────────────────────────────────────────────
// "같은 거래, tender 만 재지정". 서버가 원자적으로:
//   (a) 원본 전량 환불 (REFUND invoice 생성, voucher 복구)
//   (b) 원본 rows 복사하여 new SALE invoice 생성 (새 payments 로)
//   (c) new SALE.originalInvoiceId = 원본 SALE.id (추적)
//
// 조건 (서버가 재검증, 실패 시 전체 rollback):
//   - 원본 type === SALE, refunds(type=REFUND) 자식 없음
//   - orig.shiftId === current shift
//   - now - orig.createdAt < 10분
//   - 원본 payments 에 customer-voucher 없음 (D-21)
//
// Client 는 "의도" 만 보냄 — linesTotal/rounding/creditSurcharge/tax 등 총합은
// 서버가 원본 rows + 새 payments + storeSetting.credit_surcharge_rate 로 재계산.
export interface RepayPayload {
  originalInvoiceId: number;
  payments: PaymentPayload[]; // 새 tender mix. CASH.amount = cashApplied.
  cashChange: number; // 새 결제의 cash 거스름돈 (cashIntent - cashApplied)
  note?: string;
}

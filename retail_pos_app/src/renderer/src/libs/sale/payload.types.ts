// ──────────────────────────────────────────────────────────────
// Sale create payload — 클라이언트 → 서버 (`POST /api/sale`).
//
// 설계 원칙 (sale-domain.md, schema.prisma 의 Draft 블록 참조):
//
// ★ 서버가 res.locals 에서 자동 snapshot 하는 것은 payload 에 포함하지 않음
//   (companyId, shiftId, terminalId, userId, storeSetting snapshot,
//    terminalName, userName, dayStr). 서버가 권위 있는 출처.
//
// ★ payment.amount 는 "이 tender 로 이동한 돈" (D-10):
//    CASH     — bill 적용분 합 (cashApplied). Split 여부 무관 단일 payment
//               로 집약. Change 는 invoice.cashChange 에만 기록.
//    CREDIT   — EFTPOS 에 키인된 금액 (bill + surcharge).
//    GIFTCARD — 카드에 긁힌 금액 (= bill, surcharge 없음 — D-24).
//    VOUCHER  — 차감된 voucher 금액 (= bill 적용분). entity 필드 필수.
//
// ★ Invariant:
//    Σ rows.total              == linesTotal
//    Σ rows.tax_amount         == lineTax
//    round(creditSurcharge/11) ≈ surchargeTax  (±1¢ rounding)
//    linesTotal + rounding + creditSurchargeAmount == total
//    Σ payments.amount         == total
// ──────────────────────────────────────────────────────────────

export type InvoiceTypeWire = "SALE" | "REFUND" | "SPEND";

export type RowTypeWire =
  | "NORMAL"
  | "PREPACKED"
  | "WEIGHT"
  | "WEIGHT_PREPACKED";

export type PaymentTypeWire = "CASH" | "CREDIT" | "VOUCHER" | "GIFTCARD";

// 서버 enum LineAdjustment 와 일치. 현재 "PRICE_OVERRIDE" 만 사용 (D-6).
export type LineAdjustmentWire = "PRICE_OVERRIDE";

export interface MemberSnapshotPayload {
  id: string; // CRM member id (external ref)
  name: string;
  level: number; // 할인 적용된 레벨 (스냅샷)
  phoneLast4: string | null;
}

export interface SaleRowPayload {
  index: number; // 출력 순서 (0-based)
  type: RowTypeWire;

  // Item snapshot — 마스터 변경 무관하게 재출력 가능
  itemId: number;
  name_en: string;
  name_ko: string;
  barcode: string;
  uom: string;
  taxable: boolean;

  // Price snapshot (cents)
  unit_price_original: number;
  unit_price_discounted: number | null;
  unit_price_adjusted: number | null;
  unit_price_effective: number;

  // Qty (×QTY_SCALE)
  qty: number;
  measured_weight: number | null;

  // Money totals (cents, tax-inclusive `total` + derived)
  total: number;
  tax_amount: number;
  net: number;

  // Adjustments / PP markdown metadata
  adjustments: LineAdjustmentWire[];
  ppMarkdownType: "pct" | "amt" | null;
  ppMarkdownAmount: number | null;
}

export interface PaymentPayload {
  type: PaymentTypeWire;
  // D-10 — tender 별 의미는 파일 상단 주석 참조.
  amount: number;
  // VOUCHER 전용 (D-20). 그 외 tender 는 셋 다 생략.
  entityType?: "user-voucher" | "customer-voucher";
  entityId?: number;
  entityLabel?: string;
}

// SALE 과 SPEND 는 같은 shape 으로 전송 (각각 다른 endpoint: POST /api/sale vs
// POST /api/sale/spend). SPEND 은 모든 금액 0, payments = [], member null 이며
// 서버가 강제로 정규화 (D-14~16).
// REFUND 는 별도 endpoint/flag (미정).
export interface SaleCreatePayload {
  type: "SALE" | "SPEND";

  member: MemberSnapshotPayload | null;

  // Invoice-level money (D-12 invariant). 서버가 전부 재검증.
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

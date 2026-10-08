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
  name: string | null; // null = POS 오프라인 미검증 부착 (specs/2026-08-07 참조)
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
  isPointExcluded: boolean;
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
  // S3 — C&C 주문에서 로드된 판매만 세팅 (crm RetailOrder.id 문자열).
  // 원본 SALE 전용: repay 가 합성하는 자식 SALE payload 에는 절대 넣지
  // 않는다 (sale.repay.service.synthesizeNewSalePayload). SPEND 무시.
  externalOrderId?: string;
  // T-15 (platform/D-10) — till-minted attempt id, kept until the server
  // answers ok. Optional: old tills / Runner omit it (server mints one, no
  // retry idempotency). See sale.operation.ts.
  operationId?: string;
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
  // T-15 — see SaleCreatePayload.operationId. Also the CRM refund-issue
  // identity: entityId "<operationId>:cv-refund:<tender index>".
  operationId?: string;
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
  // T-15 — stored as "<operationId>:refund" / "<operationId>:sale".
  operationId?: string;
}

// ── Money-contract vectors (T-24, audit R-16) ─────────────────────
// Golden vectors for the money rules the till and the server both apply.
// Generated from the server's own functions (the server is authoritative):
//   UPDATE_MONEY_VECTORS=1 npm test   (rewrites fixtures/money-contract-vectors.json)
// Read by sale/money-contract.test.ts (server) and by the till's
// libs/refund/money-contract.test.mjs (renderer). A renderer mismatch is a
// finding to report, not something to "fix" by regenerating.
export interface MoneyVectorLine {
  name: string;
  input: {
    unit_price_original: number;
    unit_price_discounted: number | null;
    unit_price_adjusted: number | null;
    qty: number; // ×1000
    taxable: boolean;
  };
  expected: {
    unit_price_effective: number;
    total: number;
    tax_amount: number;
    net: number;
  };
}

export interface MoneyVectorCredit {
  name: string;
  input: { amount: number; rate: number }; // CREDIT tender as keyed (bill + surcharge); rate per-1000
  expected: { bill: number; surcharge: number; surchargeTax: number };
}

export interface MoneyVectorShares {
  name: string;
  input: { creditSurcharge: number; rowTotals: number[]; linesTotal: number };
  expected: { shares: number[] };
}

export interface MoneyVectorCashRounding {
  name: string;
  input: { subtotal: number; cashOnly: boolean };
  expected: { rounding: number };
}

export interface MoneyVectorRefundRow {
  id: number;
  qty: number;
  refunded_qty: number;
  total: number;
  surcharge_share: number;
  taxable: boolean;
  isPointExcluded: boolean;
}

export interface MoneyVectorRefund {
  name: string;
  input: {
    rows: MoneyVectorRefundRow[];
    // prior REFUND children (rows only — enough for the allocation rule)
    priorRefunds: Array<{
      rows: Array<{ originalInvoiceRowId: number; total: number; surcharge_share: number; qty: number }>;
    }>;
    request: Array<{ originalInvoiceRowId: number; refund_qty: number }>;
    cashOnly: boolean;
    originalPointsEarned: number;
  };
  expected: {
    rows: Array<{ originalInvoiceRowId: number; total: number; surcharge_share: number; tax_amount: number; net: number }>;
    linesTotal: number;
    creditSurchargeAmount: number;
    lineTax: number;
    surchargeTax: number;
    rounding: number;
    total: number;
    pointsReversed: number;
  };
}

export interface MoneyVectorPoints {
  name: string;
  input: {
    rows: Array<{ total: number; isPointExcluded: boolean }>;
    linesTotal: number;
    payments: Array<{ type: PaymentTypeWire; amount: number }>;
    creditSurchargeRate: number;
    hasMember: boolean;
    cashPointRate: number;
    otherPointRate: number;
  };
  expected: { pointsEarned: number };
}

export interface MoneyContractVectors {
  version: 1;
  note: string;
  scales: { money: number; qty: number; pct: number };
  lines: MoneyVectorLine[];
  credit: MoneyVectorCredit[];
  surchargeShares: MoneyVectorShares[];
  cashRounding: MoneyVectorCashRounding[];
  refunds: MoneyVectorRefund[];
  points: MoneyVectorPoints[];
}

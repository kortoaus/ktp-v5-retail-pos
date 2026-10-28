// Invoice shapes the local server answers with (GET /api/sale, /api/sale/:id,
// POST /api/sale, /refund, /repay). Pure types — no HTTP client — so the
// refund / repay / receipt libraries and the runner's sale-core copy can import
// them without the axios service (retail-runner T-16, S-4 §3 / A12).
// The sale service (service/) re-exports every name here.

import type {
  LineAdjustmentWire,
  PaymentTypeWire,
  RowTypeWire,
} from "./payload.types";

export type InvoiceTypeWire = "SALE" | "REFUND" | "SPEND";

// 서버 응답: invoice 전체. 클라는 id/serial 정도만 쓰지만 타입은 전체 열어둠.
export interface SaleInvoiceCreated {
  id: number;
  serial: string | null;
  dayStr: string;
  total: number;
  cashChange: number;
  pointsEarned: number;
  pointsReversed: number;
  createdAt: string;
  // S3 — C&C 주문 로드 판매만. collectResult: 서버의 커밋 후 crm collect
  // 훅 결과 트라이스테이트 — collected(확인) / pending(스윕 자동 재시도)
  // / conflict(영구 실패 — 사람 확인). collectSynced 는 구형 서버가 주는
  // boolean (하위호환 — 앱이 collectResult 부재 시 폴백 매핑).
  externalOrderId?: string | null;
  collectResult?: OrderCollectResult;
  collectSynced?: boolean;
  // T-15 — true when the server returned an invoice it had already recorded
  // for this operationId (a retry after a lost response).
  replayed?: boolean;
}

export type OrderCollectResult = "collected" | "pending" | "conflict";

// 리스트 조회용 — 서버 include: rows, payments, terminal.
export interface SaleInvoiceListItem {
  id: number;
  serial: string | null;
  dayStr: string;
  type: InvoiceTypeWire;
  shiftId: number; // repay eligibility (same-shift check) 에 사용
  companyName: string;
  terminalName: string | null;
  userName: string | null;
  memberId: string | null;
  memberName: string | null;
  memberLevel: number | null;
  linesTotal: number;
  rounding: number;
  creditSurchargeAmount: number;
  lineTax: number;
  surchargeTax: number;
  total: number;
  cashChange: number;
  pointsEarned: number;
  pointsReversed: number;
  note: string | null;
  createdAt: string;
  payments: SaleInvoicePaymentItem[];
}

// 단건 조회용 — rows + payments 포함된 전체 detail.
export interface SaleInvoiceRowItem {
  id: number;
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
  originalInvoiceId: number | null;
  originalInvoiceRowId: number | null;
  refunded_qty: number;
  surcharge_share: number;
}

export interface SaleInvoicePaymentItem {
  id: number;
  type: PaymentTypeWire;
  amount: number;
  entityType: "user-voucher" | "customer-voucher" | null;
  entityId: number | null;
  entityLabel: string | null;
  createdAt: string;
}

// Refund child — invoice 가 SALE 일 때 그 아래 REFUND 자식들. Cap 계산용.
//
// ★ `type` 은 **항상 "REFUND"** — 서버의 getSaleInvoiceByIdService 가
//   `where: { type: "REFUND" }` 로 source 필터링함. Repay 로 생성되는 새 SALE
//   은 원본과 같은 originalInvoiceId 를 공유하므로 명시적 필터 없이 include 하면
//   여기 섞여 들어와 cap 계산을 망친다. 타입에 `type` 을 노출해두는 이유:
//   클라 defensive 필터가 타입 안전하게 가능하도록.
export interface SaleInvoiceRefundChild {
  id: number;
  type: InvoiceTypeWire;
  serial: string | null;
  createdAt: string;
  linesTotal: number;
  creditSurchargeAmount: number;
  rounding: number;
  total: number;
  rows: SaleInvoiceRowItem[];
  payments: SaleInvoicePaymentItem[];
}

export interface SaleInvoiceDetail extends SaleInvoiceListItem {
  originalInvoiceId: number | null;
  abn: string | null;
  phone: string | null;
  address1: string;
  address2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  memberPhoneLast4: string | null;
  rows: SaleInvoiceRowItem[];
  payments: SaleInvoicePaymentItem[];
  refunds?: SaleInvoiceRefundChild[];
}

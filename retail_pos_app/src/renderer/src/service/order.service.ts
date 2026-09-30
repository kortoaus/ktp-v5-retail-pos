// Order inbox (slice A) — local server /api/order 프록시 소비.
// 목록은 항상 실시간 프록시(crm /device/order)이며 로컬 캐시가 없다.
// dueAt 은 서버 계산 값 — 여기서는 비교/표시만 한다 (재계산 금지).

import apiService, { ApiResponse, PagingType } from "../libs/api";

// 2026-09-24 Uncles 딜리버리+Stripe (crm 스펙 §3.1): SCHEDULED·DISPATCHED·
// DELIVERED 는 DELIVERY 전용. PENDING_PAYMENT·ABANDONED 는 crm 이 현장 목록에서
// 걸러내지만 유니온에는 방어적으로 포함.
export type OrderStatus =
  | "PENDING_PAYMENT"
  | "PLACED"
  | "ACCEPTED"
  | "READY"
  | "SCHEDULED"
  | "DISPATCHED"
  | "DELIVERED"
  | "COLLECTED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED"
  | "ABANDONED";

export type OrderFulfillment = "CLICK_AND_COLLECT" | "DELIVERY";

// 실제 결제 상태 8값. 레거시 paymentStatus 는 로드 차단용 2값 투영
// (STRIPE → "PAID") — 표시는 payment.state 를 읽는다 (crm 스펙 §5.7).
export type OrderPaymentState =
  | "UNPAID"
  | "PAID"
  | "PENDING"
  | "AUTHORIZED"
  | "CAPTURED"
  | "VOIDED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export interface OrderPaymentSummary {
  state: OrderPaymentState;
  refundDue: boolean; // = "OPEN refund request exists" cache (refund-ticket spec §4.4)
  lastError: string | null; // 캡처 실패 등 (예: AUTH_EXPIRED)
  // OPEN 환불 요청 티켓 요약 — 정보 배지 "Refund requested" (이슈 아님). 구 crm 은 없음.
  openRefundRequest?: { count: number; amount: number } | null;
}

export interface OrderRefund {
  amount: number; // cents
  status: string;
  refundedAt: string; // ISO
}

export interface OrderPaymentDetail extends OrderPaymentSummary {
  authorizedAmount: number | null; // cents
  capturedAmount: number | null; // cents
  refundedAmount: number; // cents
  authorizedAt: string | null;
  capturedAt: string | null;
  voidedAt: string | null;
  refunds: OrderRefund[];
  // Card shown to staff: brand + last4 + wallet only (crm follow-up 2026-09-24).
  // Optional — an older crm omits it.
  method?: OrderPaymentMethod | null;
  receiptUrl?: string | null;
  stripePaymentIntentId: string | null;
  refundable?: number; // cents — crm 계산 잔여 환불가능액
}

export interface OrderPaymentMethod {
  brand: string | null; // Stripe card.brand raw (visa | mastercard | amex ...)
  last4: string | null;
  wallet: "apple_pay" | "google_pay" | null;
}

export type OrderPreset = "new" | "dueSoon" | "today" | "active" | "history";

export interface OrderSummary {
  id: number;
  orderNo: string;
  status: OrderStatus;
  fulfillment: OrderFulfillment;
  paymentMethod: "IN_STORE" | "STRIPE";
  paymentStatus: "UNPAID" | "PAID"; // legacy projection — STRIPE is always "PAID"
  payment: OrderPaymentSummary;
  memberId: string;
  memberName: string;
  memberPhoneLast3: string;
  subtotal: number;
  surchargeTotal: number;
  deliveryFee: number;
  total: number; // cents
  lineCount: number;
  firstLineNameEn: string | null;
  firstLineNameKo: string | null;
  requiresAgeCheck: boolean;
  pickupDate: string | null; // "YYYY-MM-DD"
  pickupSlotMinutes: number | null; // minute-of-day
  deliveryEtaDate: string | null; // "YYYY-MM-DD"
  shippingSuburb: string | null;
  shippingPostcode: string | null;
  placedAt: string; // ISO
  version: number;
  dueAt: string | null; // ISO — server-computed, display/back-compat only
  // STRIPE 4일 자동 보이드 (crm 스펙 §7) — 서버 계산, 재계산 금지.
  autoVoidAt: string | null; // ISO
  autoVoidSoon: boolean; // placedAt+72h 경과 → 앰버
  // 트리아지 (crm 분류기 정본). 과기한/이슈 판정은 이것만 — dueAt 비교 금지 (F3).
  triage?: OrderTriage;
}

// --- 2026-09-24 매장 주문 트리아지 (트리아지 스펙 §3·§4) ---
export type TriageBucket =
  | "new"
  | "pickup.today"
  | "pickup.ready"
  | "pickup.upcoming"
  | "delivery.today"
  | "delivery.out"
  | "delivery.tomorrow"
  | "delivery.upcoming";

export type TriageListBucket = TriageBucket | "issues";

export type TriageIssueKind =
  | "ACCEPT_OVERDUE"
  | "NOT_SCHEDULED"
  | "PAYMENT_FAILED"
  | "AUTO_VOID_SOON"
  | "PICKUP_NOT_READY"
  | "NOT_COLLECTED"
  | "DELIVERY_LATE";

export interface OrderTriage {
  bucket: TriageBucket | null;
  issues: TriageIssueKind[];
  issueText: string[]; // server-built English, same order as issues
}

export interface OrderBuckets {
  asOf: string;
  today: string; // Sydney YYYY-MM-DD
  nextDeliveryDate: string | null;
  deliveryWindow: { startMinutes: number | null; endMinutes: number | null };
  counts: {
    new: { total: number; pickup: number; delivery: number };
    issues: { total: number; byKind: Record<TriageIssueKind, number> };
    pickup: { today: number; ready: number; upcoming: number };
    delivery: {
      today: number;
      out: number;
      tomorrow: number;
      upcoming: number;
      tomorrowToSchedule: number;
      tomorrowScheduled: number;
    };
  };
}

// 목록 paging — pos_server 가 crm paging 의 total/bucket/asOf 를 있으면 싣는다.
// bucket 에코가 없으면 구 crm 이 bucket 을 무시한 것 → "Server update required".
export type OrderListPaging = PagingType & {
  total?: number;
  bucket?: string;
  asOf?: string;
};

export const getOrderBuckets = async (): Promise<ApiResponse<OrderBuckets>> => {
  return await apiService.get<OrderBuckets>("/api/order/buckets");
};

// --- 딜리버리 매니페스트 (인쇄용 1요청, 스펙 §4.3) ---
export interface DeliveryManifestLine {
  id: number;
  sourceItemId: number;
  nameEn: string;
  nameKo: string;
  qty: number;
  isAgeRestricted: boolean;
  options: {
    groupNameEn: string;
    groupNameKo: string;
    optionNameEn: string;
    optionNameKo: string;
    qty: number;
  }[];
}

export interface DeliveryManifestOrder {
  id: number;
  orderNo: string;
  status: string;
  version: number;
  memberName: string;
  memberPhoneLast3: string;
  shippingLabel: string | null;
  shippingAddress1: string | null;
  shippingAddress2: string | null;
  shippingSuburb: string | null;
  shippingState: string | null;
  shippingPostcode: string | null;
  shippingNote: string | null;
  requiresAgeCheck: boolean;
  total: number;
  // 배달일 (시드니 "YYYY-MM-DD") — crm 트리아지 분류기와 같은 ETA 날짜. 드라이버 런시트
  // 배달일 섹션 키. 구버전 crm 응답엔 없을 수 있음(→ 렌더가 runDate 로 묶음).
  deliveryDate?: string | null;
  lines: DeliveryManifestLine[];
  // include=contactPhone(드라이버 런시트) 때만 존재 — 멤버 현재 전화, 탈퇴·익명화 null.
  // 인쇄에만 쓰고 state·캐시·로그에 남기지 말 것.
  contactPhone?: string | null;
}

export interface DeliveryManifest {
  date: string;
  orderCount: number;
  truncated: boolean;
  orders: DeliveryManifestOrder[];
  totals: {
    sourceItemId: number;
    nameEn: string;
    nameKo: string;
    qty: number;
    orderCount: number;
  }[];
}

export const getDeliveryManifest = async (query: {
  date?: string;
  ids?: number[];
  // 드라이버 런시트 전용 — 전체 전화 opt-in (crm: DISPATCHED 포함 + 멤버 리빌 로그).
  includeContactPhone?: boolean;
}): Promise<ApiResponse<DeliveryManifest>> => {
  const params = new URLSearchParams();
  if (query.date) params.set("date", query.date);
  if (query.ids && query.ids.length > 0) params.set("ids", query.ids.join(","));
  if (query.includeContactPhone) params.set("include", "contactPhone");
  const qs = params.toString();
  return await apiService.get<DeliveryManifest>(
    `/api/order/delivery-manifest${qs ? `?${qs}` : ""}`,
  );
};

export type OrderPrintedBulkItem = { id: number; kind: "picklist" | "driversheet" };

export const recordOrdersPrintedBulk = async (
  items: OrderPrintedBulkItem[],
): Promise<ApiResponse<{ results: { id: number; ok: boolean; code?: string }[] }>> => {
  return await apiService.post(`/api/order/printed`, { items });
};

// --- 일괄 전이 (스펙 §6.5) — ≤50, 호출측이 10건 청크 순차 ---
export type OrderBulkItemInput = { id: number; version: number };
export type OrderBulkItemResult =
  | { id: number; ok: true; status: OrderStatus; version: number }
  | { id: number; ok: false; code: string; detail?: string };

export const bulkTransitionOrders = async (
  kind: "schedule" | "dispatch",
  orders: OrderBulkItemInput[],
): Promise<ApiResponse<{ results: OrderBulkItemResult[] }>> => {
  return await apiService.post<{ results: OrderBulkItemResult[] }>(
    `/api/order/${kind}`,
    { orders },
  );
};

// --- 환불 요청 티켓 (환불 티켓 스펙 §5.2·§10.1) — POS 는 요청만 ---
export type RefundRequestReason =
  | "REJECTED_AFTER_CAPTURE"
  | "PICKING_SHORTFALL"
  | "CUSTOMER_REQUEST"
  | "OTHER";

export type ManualRefundRequestReason = Exclude<
  RefundRequestReason,
  "REJECTED_AFTER_CAPTURE"
>;

export interface RefundRequest {
  id: number;
  reason: RefundRequestReason;
  status: "OPEN" | "COMPLETED" | "DECLINED";
  requestedAmount: number;
  processedAmount: number | null;
  note: string;
  source: "POS" | "RUNNER" | "SYSTEM";
  sourceTerminal: string;
  requestedByName: string;
  lines: { orderLineId: number; name_en: string; qty: number; amount: number }[];
  declineReason: string | null;
  processedAt: string | null;
  createdAt: string;
  processing: boolean;
}

export type CreateRefundRequestBody = {
  requestKey: string;
  reason: ManualRefundRequestReason;
  lines?: { lineId: number; qty: number }[];
  amount?: number;
  note?: string;
};

export const createRefundRequest = async (
  orderId: number,
  body: CreateRefundRequestBody,
): Promise<
  ApiResponse<RefundRequest & { refundable: number; otherOpenAmount: number }>
> => {
  return await apiService.post(`/api/order/${orderId}/refund-requests`, body);
};

export const getRefundRequests = async (
  orderId: number,
): Promise<ApiResponse<{ requests: RefundRequest[]; refundable: number }>> => {
  return await apiService.get(`/api/order/${orderId}/refund-requests`);
};

// qs 는 호출측이 만든 쿼리스트링 그대로 (로컬 서버는 통과, crm 이 해석).
// 지원 파라미터: preset, fulfillment, page, limit, 그리고 S3-b 의 keyword
// (주문번호 / 완전한 전화번호 / 이름 2자↑ — 서버가 해석하며, keyword 가 있으면
// preset 을 무시하고 PLACED|ACCEPTED|READY 로 고정한다. 거부 시 ok:false + msg).
export const getOrders = async (
  qs: string,
): Promise<ApiResponse<OrderSummary[]>> => {
  return await apiService.get<OrderSummary[]>(`/api/order${qs}`);
};

// --- 슬라이스 B: 상세 + 전이 ---
// 정본은 crm-server mapRetailOrderAdminDetail + dueAt (로컬 서버는 프록시).
// 상세는 요약형과 달리 lineCount/firstLineName* 이 없고 lines/events 전체.
// 전이 충돌은 status 409 / msg "TRANSITION_CONFLICT" — 상세 재조회로
// 실상태를 학습한다 (스펙 2026-08-13).

export interface OrderLineOption {
  sourceOptionGroupId: number;
  sourceOptionItemId: number;
  groupName_en: string;
  groupName_ko: string;
  optionName_en: string;
  optionName_ko: string;
  priceDelta: number; // 단위당 cents
  qty: number;
}

export interface OrderLine {
  id: number;
  sourceItemId: number;
  name_en: string;
  name_ko: string;
  thumb: string;
  qty: number; // EA 정수 (POS QTY_SCALE 아님)
  unitBasePrice: number; // cents
  optionsTotal: number; // 단위당 cents
  unitPrice: number; // cents
  lineTotal: number; // cents
  taxable: boolean;
  deliverySurchargePerUnit: number; // cents
  isAgeRestricted: boolean;
  sort: number;
  // S2 러너 피킹 확정 수량 (EA 정수). null = 미기록. READY 로드 시 이 값을
  // 쓴다 (0 라인은 제외 — 스펙 §1.2).
  pickedQty: number | null;
  // 판별자(오너 확정): options.length > 0 = Made to Order, 아니면 Picking.
  options: OrderLineOption[];
}

export interface OrderEvent {
  type: string;
  actorType: string;
  actorLabel: string;
  note: string;
  createdAt: string; // ISO
}

export interface OrderDetail {
  id: number;
  orderNo: string;
  fulfillment: OrderFulfillment;
  status: OrderStatus;
  paymentMethod: "IN_STORE" | "STRIPE";
  paymentStatus: "UNPAID" | "PAID"; // legacy projection — STRIPE is always "PAID"
  payment: OrderPaymentDetail;
  memberId: string;
  memberName: string;
  memberPhoneLast3: string;
  pickupDate: string | null; // "YYYY-MM-DD"
  pickupSlotMinutes: number | null; // minute-of-day
  deliveryEtaDate: string | null; // "YYYY-MM-DD"
  shippingLabel: string | null;
  shippingAddress1: string | null;
  shippingAddress2: string | null;
  shippingSuburb: string | null;
  shippingState: string | null;
  shippingPostcode: string | null;
  shippingNote: string | null;
  subtotal: number; // cents
  surchargeTotal: number; // cents
  deliveryFee: number; // cents
  total: number; // cents
  requiresAgeCheck: boolean;
  rejectReason: string | null;
  posInvoiceSerial: string | null;
  version: number;
  placedAt: string; // ISO
  acceptedAt: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  cancelledAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  scheduledAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  abandonedAt: string | null;
  createdAt: string; // ISO
  dueAt: string | null; // ISO — server-computed
  autoVoidAt: string | null; // ISO
  autoVoidSoon: boolean;
  triage?: OrderTriage;
  refundRequests?: RefundRequest[]; // createdAt asc
  lines: OrderLine[];
  events: OrderEvent[];
}

export const getOrder = async (
  id: number,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.get<OrderDetail>(`/api/order/${id}`);
};

export const acceptOrder = async (
  id: number,
  version: number,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.post<OrderDetail>(`/api/order/${id}/accept`, {
    version,
  });
};

export const readyOrder = async (
  id: number,
  version: number,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.post<OrderDetail>(`/api/order/${id}/ready`, {
    version,
  });
};

export const rejectOrder = async (
  id: number,
  version: number,
  reason: string,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.post<OrderDetail>(`/api/order/${id}/reject`, {
    version,
    reason,
  });
};

// --- 2026-09-24 딜리버리 전이 (crm 스펙 §5.3) ---
// POS 는 단건만 쓴다 (일괄 Schedule/Dispatch 는 러너 전담, 스펙 §9).
// schedule 은 Stripe 캡처를 동반 — 실패는 402 PAYMENT_CAPTURE_FAILED
// (result.reason) / 503 PAYMENT_PROVIDER_UNAVAILABLE / STRIPE_NOT_CONFIGURED.
export const scheduleOrder = async (
  id: number,
  version: number,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.post<OrderDetail>(`/api/order/${id}/schedule`, {
    version,
  });
};

export const dispatchOrder = async (
  id: number,
  version: number,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.post<OrderDetail>(`/api/order/${id}/dispatch`, {
    version,
  });
};

export const deliverOrder = async (
  id: number,
  version: number,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.post<OrderDetail>(`/api/order/${id}/deliver`, {
    version,
  });
};

// --- 슬라이스 C: 인쇄 기록 ---
// 인쇄 성공 후 best-effort 기록 — 실패해도 인쇄 흐름을 막지 않는다
// (호출부 console.error only). 전이가 아니므로 version 없음, 종결 주문에도
// 허용(재인쇄). 응답은 전이와 동일한 갱신된 상세 DTO.

export type OrderPrintedBody =
  | { kind: "picklist" }
  | { kind: "label"; lineId: number };

export const recordOrderPrinted = async (
  id: number,
  body: OrderPrintedBody,
): Promise<ApiResponse<OrderDetail>> => {
  return await apiService.post<OrderDetail>(`/api/order/${id}/printed`, body);
};

export type RevealedMemberPhone = {
  memberId: string;
  phone: string;
  phoneLast4: string | null;
};

// 전화 리빌 — 주문 스코프 프록시. 공개된 번호는 호출측 로컬 state 에만
// 보관할 것(캐시/스토리지 금지 — web client MemberDetail 불변식과 동일).
export const revealOrderMemberPhone = async (
  id: number,
): Promise<ApiResponse<RevealedMemberPhone>> => {
  return await apiService.post<RevealedMemberPhone>(
    `/api/order/${id}/member-phone`,
  );
};


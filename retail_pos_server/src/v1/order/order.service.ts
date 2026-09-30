import { crmApiService } from "../../libs/cloud.api";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  UnauthorizedException,
} from "../../libs/exceptions";
import { PagingType } from "../../types/cloud";
import {
  MANUAL_REFUND_REQUEST_REASONS,
  type OrderBucketsWire,
  type OrderBulkResultWire,
  type OrderDetailWire,
  type OrderSummaryWire,
  type RefundRequestWire,
} from "./order.types";

// NOTE: customer-voucher.service.ts 의 requireOk 판 복제 (스펙 지시 — 공용화는
// 클린업 패스로 기록만, BACKLOG 참조).
export function requireOk<T>(res: {
  ok: boolean;
  msg?: string;
  status?: number;
  result?: T | null;
}): T {
  if (!res.ok || res.result == null) {
    const msg = res.msg || "CRM order request failed";
    if (res.status === 400 || res.status === 404) {
      throw new BadRequestException(msg);
    }
    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException(msg);
    }
    if (res.status === 0) {
      throw new InternalServerException("CRM order service unavailable");
    }
    if (res.status && res.status >= 500) {
      throw new InternalServerException("CRM order service unavailable");
    }
    throw new HttpException(res.status ?? 502, msg);
  }
  return res.result;
}

// 전이 전용 판 — crm 이 결제(Stripe) 사유 코드로 거절한 경우를 뭉개지 않고
// 그대로 앱에 전달한다 (2026-09-24 스펙 §6.2): 402 PAYMENT_CAPTURE_FAILED
// (result.reason = AUTH_EXPIRED 등), 503 PAYMENT_PROVIDER_UNAVAILABLE /
// STRIPE_NOT_CONFIGURED. 코드형(UPPER_SNAKE) msg 의 5xx 만 통과 — crm 전역
// 핸들러의 "Internal Server Error" 나 네트워크 실패(status 0)는 기존
// requireOk 매핑("CRM order service unavailable") 그대로.
const CRM_ERROR_CODE = /^[A-Z][A-Z0-9_]+$/;

export function requireTransitionOk<T>(res: {
  ok: boolean;
  msg?: string;
  status?: number;
  result?: T | null;
}): T {
  if (!res.ok && res.status && res.msg && CRM_ERROR_CODE.test(res.msg)) {
    if (res.status === 402 || res.status >= 500) {
      throw new HttpException(res.status, res.msg, res.result ?? null);
    }
  }
  return requireOk(res);
}

// crm paging({page,limit,total,totalPages}) → 로컬 표준 paging 변환.
// cloud.api 는 paging 을 그대로 통과시키므로 여기서 형을 맞춰야
// 앱의 ServerPagingList 가 동작한다.
// 트리아지 스펙 §4.2·§6.2: total(“Showing 100 of N”)·bucket 에코(구 crm 감지)·
// asOf 는 있을 때만 가산 — 앱이 bucket 에코 부재로 "Server update required" 를 판별한다.
export type OrderPagingWire = PagingType & {
  total?: number;
  bucket?: string;
  asOf?: string;
};

export function mapCrmPaging(paging: unknown): OrderPagingWire | null {
  if (!paging || typeof paging !== "object") return null;
  const maybe = paging as {
    page?: unknown;
    totalPages?: unknown;
    total?: unknown;
    bucket?: unknown;
    asOf?: unknown;
  };
  const page = Number(maybe.page);
  const totalPages = Number(maybe.totalPages);
  if (!Number.isFinite(page) || !Number.isFinite(totalPages)) return null;
  const mapped: OrderPagingWire = {
    currentPage: page,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
  if (typeof maybe.total === "number" && Number.isFinite(maybe.total)) {
    mapped.total = maybe.total;
  }
  if (typeof maybe.bucket === "string") mapped.bucket = maybe.bucket;
  if (typeof maybe.asOf === "string") mapped.asOf = maybe.asOf;
  return mapped;
}

export async function getOrdersService(qs: string) {
  const res = await crmApiService.get<OrderSummaryWire[]>(
    `/device/order${qs ? `?${qs}` : ""}`,
  );
  const result = requireOk(res);
  return { ok: true, result, paging: mapCrmPaging(res.paging) };
}

// --- 슬라이스 B: 상세 + 전이 프록시 ---
// 전부 crm 실시간 프록시, 로컬 영속 없음. body 는 패스스루(version/reason
// 검증은 crm 400). 전이 충돌은 crm 409 "TRANSITION_CONFLICT" 가
// requireOk 의 fall-through HttpException(409) 으로 그대로 앱에 전달된다.
// READY→REJECTED admin 게이트는 앱(버튼 미표시) 몫 — 서버는 추가 crm
// 조회를 하지 않는다(스펙 결정: crm 409 가 최종 방어선).

export async function getOrderDetailService(id: number) {
  const res = await crmApiService.get<OrderDetailWire>(`/device/order/${id}`);
  return { ok: true, result: requireOk(res) };
}

export async function acceptOrderService(id: number, body: unknown) {
  const res = await crmApiService.post<OrderDetailWire>(
    `/device/order/${id}/accept`,
    body,
  );
  return { ok: true, result: requireTransitionOk(res) };
}

export async function readyOrderService(id: number, body: unknown) {
  const res = await crmApiService.post<OrderDetailWire>(
    `/device/order/${id}/ready`,
    body,
  );
  return { ok: true, result: requireTransitionOk(res) };
}

// reject — crm 이 캡처 후 거절이면 환불 요청 티켓을 자동 생성하고 그
// requestedByName 에 staffName 을 쓴다 (환불 티켓 스펙 §4.2). 직원명은 앱 body 가
// 아니라 로그인 유저에서 서버가 주입(피킹 pickerName 선례). version/reason 만 통과.
export function buildRejectBody(
  body: unknown,
  staffName: string,
): { version: unknown; reason: unknown; staffName?: string } {
  const maybe = (body && typeof body === "object" ? body : {}) as {
    version?: unknown;
    reason?: unknown;
  };
  const name = staffName.trim().slice(0, 100);
  return {
    version: maybe.version,
    reason: maybe.reason,
    ...(name ? { staffName: name } : {}),
  };
}

export async function rejectOrderService(
  id: number,
  body: unknown,
  staffName = "",
) {
  const res = await crmApiService.post<OrderDetailWire>(
    `/device/order/${id}/reject`,
    buildRejectBody(body, staffName),
  );
  return { ok: true, result: requireTransitionOk(res) };
}

// --- 2026-09-24 딜리버리 전이 프록시 (crm 스펙 §5.3, J6) ---
// 전부 DELIVERY 전용 — fulfillment·상태 검증은 crm(409 TRANSITION_CONFLICT /
// NOT_FOR_CLICK_AND_COLLECT). 단건 body { version } 패스스루, 일괄 body
// { orders: [{ id, version }] } ≤50 패스스루(검증 crm 400) — 응답
// { results: [{ id, ok, status?, version?, code?, detail? }] } (부분 성공).
// schedule 은 Stripe 캡처를 동반한다 — crmApiService 30s 타임아웃 관례 유지.
export type DeliveryTransitionKind = "schedule" | "dispatch" | "deliver";

export async function deliveryTransitionOrderService(
  id: number,
  kind: DeliveryTransitionKind,
  body: unknown,
) {
  const res = await crmApiService.post<OrderDetailWire>(
    `/device/order/${id}/${kind}`,
    body,
  );
  return { ok: true, result: requireTransitionOk(res) };
}

export async function bulkDeliveryTransitionOrdersService(
  kind: "schedule" | "dispatch",
  body: unknown,
) {
  const res = await crmApiService.post<OrderBulkResultWire>(
    `/device/order/${kind}`,
    body,
  );
  return { ok: true, result: requireOk(res) };
}

// --- S2: 러너 피킹 확정 프록시 ---
// POST /device/order/:id/picking — ACCEPTED→READY 의 피킹 변형.
// pickerName 은 클라이언트 body 를 신뢰하지 않고 userMiddleware 가 해석한
// 로그인 유저 이름을 서버가 주입한다(클라이언트가 보내도 버림). version/
// lines 만 body 에서 통과 — 구조·커버리지 검증은 crm(400), 상태·버전 충돌은
// crm 409 TRANSITION_CONFLICT 가 requireOk fall-through 로 그대로 앱에 전달.
export function buildPickingBody(
  body: unknown,
  pickerName: string,
): { version: unknown; lines: unknown; pickerName: string } {
  const maybe = (body && typeof body === "object" ? body : {}) as {
    version?: unknown;
    lines?: unknown;
  };
  return { version: maybe.version, lines: maybe.lines, pickerName };
}

export async function pickingOrderService(
  id: number,
  body: unknown,
  pickerName: string,
) {
  const res = await crmApiService.post<OrderDetailWire>(
    `/device/order/${id}/picking`,
    buildPickingBody(body, pickerName),
  );
  return { ok: true, result: requireTransitionOk(res) };
}

// --- 슬라이스 C: 인쇄 기록 프록시 ---
// POST /device/order/:id/printed — body 패스스루({kind:"picklist"} 또는
// {kind:"label", lineId}). kind/lineId 검증은 crm(400). 상태 전이가 아니라
// version 불요, 종결 주문에도 허용(재인쇄). 응답은 전이와 동일한 상세 DTO.
export async function printedOrderService(id: number, body: unknown) {
  const res = await crmApiService.post<OrderDetailWire>(
    `/device/order/${id}/printed`,
    body,
  );
  return { ok: true, result: requireOk(res) };
}

// --- 전화 리빌 프록시 (주문 스코프) ---
// 앱이 임의 memberId 를 직접 던지지 못하도록 주문 상세에서 memberId 를
// 확인한 뒤 crm 의 기존 디바이스 리빌 초크포인트를 호출한다. 모든 공개는
// crm MemberRevealLog 에 감사 기록된다(actorType DEVICE).
export type RevealedMemberPhoneWire = {
  memberId: string;
  phone: string;
  phoneLast4: string | null;
};

export async function revealOrderMemberPhoneService(id: number) {
  const detailRes = await crmApiService.get<OrderDetailWire>(
    `/device/order/${id}`,
  );
  const detail = requireOk(detailRes);

  const res = await crmApiService.post<RevealedMemberPhoneWire>(
    "/device/member/phone",
    { memberId: detail.memberId },
  );
  return { ok: true, result: requireOk(res) };
}


// --- 2026-09-24 매장 주문 트리아지 (트리아지 스펙 §5) ---
// 전부 crm 실시간 프록시, 계산 없음. 목록의 bucket/issue 파라미터는 기존
// GET /api/order 가 쿼리스트링을 그대로 통과시키므로 별도 라우트가 없다(F2).

export async function getOrderBucketsService() {
  const res = await crmApiService.get<OrderBucketsWire>("/device/order/buckets");
  return { ok: true, result: requireOk(res) };
}

// ?date=YYYY-MM-DD 또는 ?ids=1,2,3 — 검증은 crm(400).
export async function getDeliveryManifestService(qs: string) {
  const res = await crmApiService.get<unknown>(
    `/device/order/delivery-manifest${qs ? `?${qs}` : ""}`,
  );
  return { ok: true, result: requireOk(res) };
}

// 일괄 인쇄 기록 — body { items: [{ id, kind, lineId? }] } ≤50 패스스루 (검증 crm).
export async function bulkPrintedOrdersService(body: unknown) {
  const res = await crmApiService.post<unknown>("/device/order/printed", body);
  return { ok: true, result: requireOk(res) };
}

// --- 환불 요청 티켓 (환불 티켓 스펙 §5.2·§10.1, R5) ---
// POS 는 환불하지 않는다 — 요청만. source/sourceTerminal/requestedByName 은
// 서버가 채운다(앱 body 의 같은 필드는 버림). REJECTED_AFTER_CAPTURE 는
// SYSTEM 전용이라 로컬에서 먼저 거절한다(crm 도 400).
export type RefundRequestBodyWire = {
  requestKey: unknown;
  reason: unknown;
  lines?: unknown;
  amount?: unknown;
  note?: unknown;
  source: "POS";
  sourceTerminal: string;
  requestedByName: string;
};

export function buildRefundRequestBody(
  body: unknown,
  ctx: { terminalName: string; staffName: string },
): RefundRequestBodyWire {
  const maybe = (body && typeof body === "object" ? body : {}) as {
    requestKey?: unknown;
    reason?: unknown;
    lines?: unknown;
    amount?: unknown;
    note?: unknown;
  };
  if (
    !(MANUAL_REFUND_REQUEST_REASONS as readonly unknown[]).includes(maybe.reason)
  ) {
    throw new BadRequestException(
      "reason must be PICKING_SHORTFALL, CUSTOMER_REQUEST or OTHER",
    );
  }
  const out: RefundRequestBodyWire = {
    requestKey: maybe.requestKey,
    reason: maybe.reason,
    source: "POS",
    sourceTerminal: ctx.terminalName.trim().slice(0, 100),
    requestedByName: ctx.staffName.trim().slice(0, 100),
  };
  if (maybe.lines !== undefined && maybe.lines !== null) out.lines = maybe.lines;
  if (maybe.amount !== undefined && maybe.amount !== null) out.amount = maybe.amount;
  if (typeof maybe.note === "string") out.note = maybe.note;
  return out;
}

// 티켓 오류는 코드와 상세를 앱에 그대로 — 409 AMOUNT_EXCEEDS_REFUNDABLE
// { refundable } / NOT_REFUNDABLE / REQUEST_KEY_CONFLICT, 400 NOT_ONLINE_PAID.
// 그 외(400 문구·401·5xx·네트워크)는 requireOk 매핑.
export function requireRefundRequestOk<T>(res: {
  ok: boolean;
  msg?: string;
  status?: number;
  result?: T | null;
}): T {
  if (!res.ok && res.msg && CRM_ERROR_CODE.test(res.msg)) {
    if (res.status === 409 || res.status === 400) {
      throw new HttpException(res.status, res.msg, res.result ?? null);
    }
  }
  return requireOk(res);
}

export type RefundRequestCreatedWire = RefundRequestWire & {
  refundable: number;
  otherOpenAmount: number;
};

export async function createRefundRequestService(
  id: number,
  body: unknown,
  ctx: { terminalName: string; staffName: string },
) {
  const res = await crmApiService.post<RefundRequestCreatedWire>(
    `/device/order/${id}/refund-requests`,
    buildRefundRequestBody(body, ctx),
  );
  return { ok: true, result: requireRefundRequestOk(res) };
}

export async function listRefundRequestsService(id: number) {
  const res = await crmApiService.get<{
    requests: RefundRequestWire[];
    refundable: number;
  }>(`/device/order/${id}/refund-requests`);
  return { ok: true, result: requireOk(res) };
}

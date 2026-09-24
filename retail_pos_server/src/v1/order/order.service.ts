import { crmApiService } from "../../libs/cloud.api";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  UnauthorizedException,
} from "../../libs/exceptions";
import { PagingType } from "../../types/cloud";
import type {
  OrderBulkResultWire,
  OrderDetailWire,
  OrderSummaryWire,
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
export function mapCrmPaging(paging: unknown): PagingType | null {
  if (!paging || typeof paging !== "object") return null;
  const maybe = paging as { page?: unknown; totalPages?: unknown };
  const page = Number(maybe.page);
  const totalPages = Number(maybe.totalPages);
  if (!Number.isFinite(page) || !Number.isFinite(totalPages)) return null;
  return {
    currentPage: page,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
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

export async function rejectOrderService(id: number, body: unknown) {
  const res = await crmApiService.post<OrderDetailWire>(
    `/device/order/${id}/reject`,
    body,
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


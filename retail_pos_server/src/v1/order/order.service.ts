import { crmApiService } from "../../libs/cloud.api";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  UnauthorizedException,
} from "../../libs/exceptions";
import { PagingType } from "../../types/cloud";
import type { OrderDetailWire, OrderSummaryWire } from "./order.types";

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
  return { ok: true, result: requireOk(res) };
}

export async function readyOrderService(id: number, body: unknown) {
  const res = await crmApiService.post<OrderDetailWire>(
    `/device/order/${id}/ready`,
    body,
  );
  return { ok: true, result: requireOk(res) };
}

export async function rejectOrderService(id: number, body: unknown) {
  const res = await crmApiService.post<OrderDetailWire>(
    `/device/order/${id}/reject`,
    body,
  );
  return { ok: true, result: requireOk(res) };
}

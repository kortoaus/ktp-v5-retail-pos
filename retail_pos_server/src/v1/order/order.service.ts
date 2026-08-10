import { crmApiService } from "../../libs/cloud.api";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  UnauthorizedException,
} from "../../libs/exceptions";
import { PagingType } from "../../types/cloud";
import type { OrderSummaryWire } from "./order.types";

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

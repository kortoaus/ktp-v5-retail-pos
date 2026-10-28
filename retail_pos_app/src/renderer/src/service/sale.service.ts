import apiService, { ApiResponse } from "../libs/api";
import { trackCheckout } from "../libs/checkout-inflight";
import type {
  PaymentTypeWire,
  SaleCreatePayload,
} from "../libs/sale/payload.types";
import type { RefundCreatePayload } from "../libs/refund/payload.types";
import {
  operationIdFor,
  repayAttemptKey,
  settleOperation,
} from "../libs/operation-id";
import { sendRefundWithOperation } from "../libs/refund/submit-refund";
import {
  sendSaleWithOperation,
  type SaleBody,
  type SpendBody,
} from "../libs/sale/submit-sale";
import type {
  InvoiceTypeWire,
  SaleInvoiceCreated,
  SaleInvoiceDetail,
  SaleInvoiceListItem,
} from "../libs/sale/invoice.types";

// The invoice shapes live in the pure libs/sale/invoice.types.ts (T-16);
// re-exported so every existing import from this service keeps working.
export type {
  InvoiceTypeWire,
  OrderCollectResult,
  SaleInvoiceCreated,
  SaleInvoiceDetail,
  SaleInvoiceListItem,
  SaleInvoicePaymentItem,
  SaleInvoiceRefundChild,
  SaleInvoiceRowItem,
} from "../libs/sale/invoice.types";

export interface SaleSearchParams {
  page?: number;
  limit?: number;
  keyword?: string;
  from?: string; // ISO
  to?: string; // ISO
  memberId?: string;
  minTotal?: number; // cents
  maxTotal?: number; // cents
  type?: InvoiceTypeWire;
}

// The HTTP half of a sale submit (T-1): the body already carries the
// attempt's operationId — libs/sale/submit-sale.ts mints, resends and settles
// it (T-15, one attempt per cart slot) and injects this function.
// T-24 (R-10): an update never installs while this is in flight.
export async function postSale(
  body: SaleBody,
): Promise<ApiResponse<SaleInvoiceCreated>> {
  return trackCheckout(apiService.post<SaleInvoiceCreated>("/api/sale", body));
}

// T-15 — every submit carries its attempt's operationId (libs/operation-id.ts),
// one attempt per cart slot: a retry from the same cart after a lost response
// replays the original invoice; another cart is always its own attempt.
export async function createSale(
  payload: SaleCreatePayload,
  cartIndex: number,
): Promise<ApiResponse<SaleInvoiceCreated>> {
  return sendSaleWithOperation(payload, cartIndex, postSale);
}

// 내부 소비 (SPEND). 금액 0, payments 없음. 서버가 row-level 강제 정규화.
// T-10 — the body carries the cart slot's attempt operationId;
// libs/sale/submit-sale.ts submitSpend mints, resends and settles it.
export async function createSpend(
  body: SpendBody,
): Promise<ApiResponse<SaleInvoiceCreated>> {
  return trackCheckout(
    apiService.post<SaleInvoiceCreated>("/api/sale/spend", body),
  );
}

// REFUND invoice 생성. 서버가 D-26 drift-absorbing 수식으로 canonical 재계산
// (sale.refund.service.ts 헤더 주석 참조). 응답은 새 REFUND invoice 의 요약 필드.
// T-16 — the attempt key / operationId / settle discipline lives in the pure
// libs/refund/submit-refund.ts; this is the HTTP half (trackCheckout, the
// client's 30 s timeout).
export async function createRefundInvoice(
  payload: RefundCreatePayload,
): Promise<ApiResponse<SaleInvoiceCreated>> {
  return sendRefundWithOperation(payload, (body) =>
    trackCheckout(
      apiService.post<SaleInvoiceCreated>("/api/sale/refund", body),
    ),
  );
}

// Repay — 원본 전량 환불 + 새 tender 로 새 SALE 을 한 transaction 에 원자적
// 생성. 서버가 조건 재검증 (type=SALE / refunds=0 / shift / <10분 /
// customer-voucher 없음). 응답: { refund, newSale } — 영수증 두 장 + drawer
// kick 은 client 에서 처리.
export interface RepayPayload {
  originalInvoiceId: number;
  payments: {
    type: PaymentTypeWire;
    amount: number;
    entityType?: "user-voucher" | "customer-voucher";
    entityId?: number;
    entityLabel?: string;
  }[];
  cashChange: number;
  note?: string;
}

export interface RepayResponse {
  refund: SaleInvoiceCreated;
  newSale: SaleInvoiceCreated;
  replayed?: boolean;
}

export async function repayInvoice(
  payload: RepayPayload,
): Promise<ApiResponse<RepayResponse>> {
  const attemptKey = repayAttemptKey(payload.originalInvoiceId);
  const operationId = operationIdFor(attemptKey);
  const res = await trackCheckout(
    apiService.post<RepayResponse>("/api/sale/repay", {
      ...payload,
      operationId,
    }),
  );
  settleOperation(attemptKey, res);
  return res;
}

export async function searchSaleInvoices(
  params: SaleSearchParams,
): Promise<ApiResponse<SaleInvoiceListItem[]>> {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set("page", String(params.page));
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.keyword) qs.set("keyword", params.keyword);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.memberId) qs.set("memberId", params.memberId);
  if (params.minTotal != null) qs.set("minTotal", String(params.minTotal));
  if (params.maxTotal != null) qs.set("maxTotal", String(params.maxTotal));
  if (params.type) qs.set("type", params.type);
  const q = qs.toString();
  return apiService.get<SaleInvoiceListItem[]>(
    q ? `/api/sale?${q}` : "/api/sale",
  );
}


export async function getSaleInvoiceById(
  id: number,
): Promise<ApiResponse<SaleInvoiceDetail>> {
  return apiService.get<SaleInvoiceDetail>(`/api/sale/${id}`);
}

// `originalInvoiceId = id` 인 모든 children (REFUND + repay-SALE). Reprint 에서
// parent + children 을 한 strip 으로 출력할 때 사용. Server ordering: id ASC
// → repay 케이스면 REFUND 먼저, 새 SALE 다음 순서로 반환.
export async function getSaleInvoiceChildren(
  id: number,
): Promise<ApiResponse<SaleInvoiceDetail[]>> {
  return apiService.get<SaleInvoiceDetail[]>(`/api/sale/${id}/children`);
}

// 현재 terminal (ip-address 헤더로 식별) 의 가장 최근 invoice.
// 없으면 result: null.
export async function getLatestSaleInvoice(): Promise<
  ApiResponse<SaleInvoiceDetail | null>
> {
  return apiService.get<SaleInvoiceDetail | null>("/api/sale/latest");
}

import apiService, { ApiResponse } from "../libs/api";
import type {
  LineAdjustmentWire,
  PaymentTypeWire,
  RowTypeWire,
  SaleCreatePayload,
} from "../libs/sale/payload.types";

export type InvoiceTypeWire = "SALE" | "REFUND" | "SPEND";

// 서버 응답: invoice 전체. 클라는 id/serial 정도만 쓰지만 타입은 전체 열어둠.
export interface SaleInvoiceCreated {
  id: number;
  serial: string | null;
  dayStr: string;
  total: number;
  cashChange: number;
  createdAt: string;
}

// 리스트 조회용 — 서버 include: rows, payments, terminal.
export interface SaleInvoiceListItem {
  id: number;
  serial: string | null;
  dayStr: string;
  type: InvoiceTypeWire;
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
  note: string | null;
  createdAt: string;
}

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

export async function createSale(
  payload: SaleCreatePayload,
): Promise<ApiResponse<SaleInvoiceCreated>> {
  return apiService.post<SaleInvoiceCreated>("/api/sale", payload);
}

// 내부 소비 (SPEND). 금액 0, payments 없음. 서버가 row-level 강제 정규화.
export async function createSpend(
  payload: SaleCreatePayload,
): Promise<ApiResponse<SaleInvoiceCreated>> {
  return apiService.post<SaleInvoiceCreated>("/api/sale/spend", payload);
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
export interface SaleInvoiceRefundChild {
  id: number;
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

export async function getSaleInvoiceById(
  id: number,
): Promise<ApiResponse<SaleInvoiceDetail>> {
  return apiService.get<SaleInvoiceDetail>(`/api/sale/${id}`);
}

// 현재 terminal (ip-address 헤더로 식별) 의 가장 최근 invoice.
// 없으면 result: null.
export async function getLatestSaleInvoice(): Promise<
  ApiResponse<SaleInvoiceDetail | null>
> {
  return apiService.get<SaleInvoiceDetail | null>("/api/sale/latest");
}

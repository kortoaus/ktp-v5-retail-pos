import apiService, { ApiResponse } from "../libs/api";
import { TerminalShift } from "../types/models";

interface OpenShiftPayload {
  openedNote: string;
  cashInDrawer: number;
  getBackItemIds: number[];
  getBackOptionIds: number[];
  isPublicHoliday: boolean;
}

export const openShift = async (
  data: OpenShiftPayload,
): Promise<ApiResponse<number>> => {
  return await apiService.post<number>("/api/shift/open", data);
};

export const getCurrentShift = async (): Promise<
  ApiResponse<TerminalShift | null>
> => {
  return await apiService.get<TerminalShift | null>("/api/shift/current");
};

// NOTE: §4-2 에서 서버 SUM-based 로 전면 rewrite 예정 — 신규 필드
// (salesLinesTotal / rounding / counts / spendRetailValue / repayCount / giftcard /
// creditSurcharge) 는 그때 포함. 현재는 기존 close flow 호환 유지를 위해
// VOUCHER 만 User/Customer 로 split.
export type ClosingShiftData = {
  shift: TerminalShift;
  salesCash: number;
  salesCredit: number;
  salesUserVoucher: number;
  salesCustomerVoucher: number;
  salesTax: number;
  refundsCash: number;
  refundsCredit: number;
  refundsUserVoucher: number;
  refundsCustomerVoucher: number;
  refundsTax: number;
  cashIn: number;
  cashOut: number;
};

export const getClosingShiftData = async (): Promise<
  ApiResponse<ClosingShiftData>
> => {
  return await apiService.post<ClosingShiftData>("/api/shift/close/data");
};

export type CloseShiftDTO = {
  closedNote: string;
  endedCashExpected: number;
  endedCashActual: number;
  salesCash: number;
  salesCredit: number;
  salesUserVoucher: number;
  salesCustomerVoucher: number;
  salesTax: number;
  refundsCash: number;
  refundsCredit: number;
  refundsUserVoucher: number;
  refundsCustomerVoucher: number;
  refundsTax: number;
  cashIn: number;
  cashOut: number;
  totalCashIn: number;
  totalCashOut: number;
};

export const closeShift = async (
  data: CloseShiftDTO,
): Promise<ApiResponse<number>> => {
  return await apiService.post<number>("/api/shift/close", data);
};

export const getShiftById = async (
  id: number,
): Promise<ApiResponse<TerminalShift>> => {
  return await apiService.get<TerminalShift>(`/api/shift/${id}`);
};

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

// ShiftAggregate — 서버 aggregateShift() 반환형과 동일. TerminalShift 의 집계
// 필드 subset. Source of truth 는 서버 shift.service.ts.
export interface ShiftAggregate {
  salesCash: number;
  salesCredit: number;
  salesUserVoucher: number;
  salesCustomerVoucher: number;
  salesGiftcard: number;
  salesLinesTotal: number;
  salesRounding: number;
  salesCount: number;
  repayCount: number;
  salesCreditSurcharge: number;
  salesTax: number;
  refundsCash: number;
  refundsCredit: number;
  refundsUserVoucher: number;
  refundsCustomerVoucher: number;
  refundsGiftcard: number;
  refundsLinesTotal: number;
  refundsRounding: number;
  refundsCount: number;
  refundsCreditSurcharge: number;
  refundsTax: number;
  spendCount: number;
  spendRetailValue: number;
  totalCashIn: number;
  totalCashOut: number;
}

// Preview 응답 — CloseShiftScreen 이 진입 시 받아서 화면에 기대 현금 표시.
export type ClosingShiftData = {
  shift: TerminalShift;
  aggregate: ShiftAggregate;
  endedCashExpected: number;
};

export const getClosingShiftData = async (): Promise<
  ApiResponse<ClosingShiftData>
> => {
  return await apiService.post<ClosingShiftData>("/api/shift/close/data");
};

// Close DTO — cashier 입력만. 모든 집계는 서버가 재계산 (D-34 / D-37).
export type CloseShiftDTO = {
  closedNote: string;
  endedCashActual: number;
};

export const closeShift = async (
  data: CloseShiftDTO,
): Promise<ApiResponse<TerminalShift>> => {
  return await apiService.post<TerminalShift>("/api/shift/close", data);
};

export const getShiftById = async (
  id: number,
): Promise<ApiResponse<TerminalShift>> => {
  return await apiService.get<TerminalShift>(`/api/shift/${id}`);
};

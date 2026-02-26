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

export type ClosingShiftData = {
  shift: TerminalShift;
  salesCash: number;
  salesCredit: number;
  salesTax: number;
  refundsCash: number;
  refundsCredit: number;
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
  salesTax: number;
  refundsCash: number;
  refundsCredit: number;
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

import { CashInOut } from "../types/models";
import apiService, { ApiResponse } from "../libs/api";

export const createCashIO = async (data: {
  type: string;
  amount: number;
  note?: string;
}): Promise<ApiResponse<number>> => {
  return await apiService.post<number>("/api/cashio", data);
};

export const getCashIOs = async (
  qs?: string,
): Promise<ApiResponse<CashInOut[]>> => {
  const url = qs ? `/api/cashio${qs}` : "/api/cashio";
  return await apiService.get<CashInOut[]>(url);
};

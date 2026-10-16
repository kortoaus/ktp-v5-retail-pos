import { CashInOut } from "../types/models";
import apiService, { ApiResponse } from "../libs/api";
import { cashIOAttemptKey, sendWithOperation } from "../libs/operation-id";

// T-10 (F-27) — every submit carries the form attempt's operationId
// (libs/operation-id.ts): a retry after a lost answer resends it and the
// server returns the recorded entry instead of adding a second one.
export const createCashIO = async (data: {
  type: string;
  amount: number;
  note?: string;
}): Promise<ApiResponse<number>> => {
  return sendWithOperation(cashIOAttemptKey(), (operationId) =>
    apiService.post<number>("/api/cashio", { ...data, operationId }),
  );
};

export const getCashIOs = async (
  qs?: string,
): Promise<ApiResponse<CashInOut[]>> => {
  const url = qs ? `/api/cashio${qs}` : "/api/cashio";
  return await apiService.get<CashInOut[]>(url);
};

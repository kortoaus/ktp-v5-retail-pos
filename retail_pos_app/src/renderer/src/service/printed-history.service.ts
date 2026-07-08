import apiService, { type ApiResponse } from "../libs/api";

export const PRINTED_HISTORY_ENTITY_PICKUP_ORDER = "PICKUP_ORDER" as const;

export type PrintedHistoryEntityType =
  typeof PRINTED_HISTORY_ENTITY_PICKUP_ORDER;

export type PrintedHistorySummary = {
  entityId: number;
  printCount: number;
  lastPrintedAt: string;
  lastPrintedByUserId: number | null;
  lastPrintedByUserName: string | null;
};

export async function markPrintedHistory(
  entityType: PrintedHistoryEntityType,
  entityId: number,
): Promise<ApiResponse<unknown>> {
  return apiService.post<unknown>("/api/printed-history", {
    entityType,
    entityId,
  });
}

export async function getPrintedHistorySummaries(
  entityType: PrintedHistoryEntityType,
  entityIds: number[],
): Promise<ApiResponse<PrintedHistorySummary[]>> {
  if (entityIds.length === 0) {
    return { ok: true, status: 200, msg: "", result: [], paging: null };
  }

  const qs = new URLSearchParams();
  qs.set("entityType", entityType);
  qs.set("entityIds", entityIds.join(","));

  return apiService.get<PrintedHistorySummary[]>(
    `/api/printed-history?${qs.toString()}`,
  );
}

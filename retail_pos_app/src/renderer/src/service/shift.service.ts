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

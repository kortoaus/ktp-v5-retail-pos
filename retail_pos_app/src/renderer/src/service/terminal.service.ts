// Terminal 목록 + 주문 차임 토글 (StoreSettingScreen "Order chime terminals").

import apiService, { ApiResponse } from "../libs/api";

export interface TerminalChimeSetting {
  id: number;
  name: string;
  orderChimeEnabled: boolean;
}

export const getTerminals = async (): Promise<
  ApiResponse<TerminalChimeSetting[]>
> => {
  return await apiService.get<TerminalChimeSetting[]>("/api/terminal");
};

export const setTerminalOrderChime = async (
  id: number,
  enabled: boolean,
): Promise<ApiResponse<TerminalChimeSetting>> => {
  return await apiService.patch<TerminalChimeSetting>(
    `/api/terminal/${id}/order-chime`,
    { enabled },
  );
};

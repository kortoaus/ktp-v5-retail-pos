import apiService, { ApiResponse } from "../libs/api";
import { Hotkey } from "../types/models";

export async function getHotkeys(): Promise<ApiResponse<Hotkey[]>> {
  return apiService.get<Hotkey[]>(`/api/hotkey`);
}

export async function upsertHotkey(data: Hotkey): Promise<ApiResponse<Hotkey>> {
  return apiService.post<Hotkey>(`/api/hotkey`, data);
}

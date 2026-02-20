import apiService, { ApiResponse } from "../libs/api";
import { Hotkey } from "../types/models";

export type UpsertHotkeyPayload = {
  id?: number;
  name: string;
  sort: number;
  color: string;
  keys: {
    x: number;
    y: number;
    itemId: number;
    name: string;
    color: string;
  }[];
};

export async function getHotkeys(): Promise<ApiResponse<Hotkey[]>> {
  return apiService.get<Hotkey[]>(`/api/hotkey`);
}

export async function upsertHotkey(
  data: UpsertHotkeyPayload,
): Promise<ApiResponse<Hotkey>> {
  return apiService.post<Hotkey>(`/api/hotkey`, data);
}

export async function deleteHotkey(
  id: number,
): Promise<ApiResponse<null>> {
  return apiService.delete<null>(`/api/hotkey/${id}`);
}

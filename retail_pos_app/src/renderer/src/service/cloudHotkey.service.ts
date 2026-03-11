import apiService, { ApiResponse } from "../libs/api";
import { CloudHotkey } from "../types/models";

export async function getCloudHotkeys(): Promise<ApiResponse<CloudHotkey[]>> {
  return apiService.get<CloudHotkey[]>(`/api/hotkey/cloud`);
}

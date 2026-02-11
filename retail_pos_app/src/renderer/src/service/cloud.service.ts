import apiService, { ApiResponse } from "../libs/api";

export async function migrateDataFromCloudServer(): Promise<ApiResponse<void>> {
  return apiService.post<void>(`/api/cloud/migrate/item`);
}

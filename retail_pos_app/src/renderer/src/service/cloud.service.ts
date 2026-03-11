import apiService, { ApiResponse } from "../libs/api";
import { CloudPost } from "../types/models";

export async function migrateDataFromCloudServer(): Promise<ApiResponse<void>> {
  return apiService.post<void>(`/api/cloud/migrate/item`);
}

export async function getCloudPosts(): Promise<ApiResponse<CloudPost[]>> {
  return apiService.get<CloudPost[]>(`/api/cloud/post`);
}

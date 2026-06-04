import apiService, { ApiResponse } from "../libs/api";
import { CloudItemSheet, CloudPost } from "../types/models";

export type PrintedLabelUpdateSheetResult = {
  sheetId: number;
};

export async function migrateDataFromCloudServer(): Promise<ApiResponse<void>> {
  return apiService.post<void>(`/api/cloud/migrate/item`);
}

export async function getCloudPosts(): Promise<ApiResponse<CloudPost[]>> {
  return apiService.get<CloudPost[]>(`/api/cloud/post`);
}

export async function getCloudLabelUpdateSheets(
  qs: string,
): Promise<ApiResponse<CloudItemSheet[]>> {
  return apiService.get<CloudItemSheet[]>(
    `/api/cloud/item-sheet/label-update${qs}`,
  );
}

export async function getCloudLabelUpdateSheetById(
  id: number | string,
): Promise<ApiResponse<CloudItemSheet>> {
  return apiService.get<CloudItemSheet>(
    `/api/cloud/item-sheet/label-update/${id}`,
  );
}

export async function getPrintedLabelUpdateSheetIds(): Promise<
  ApiResponse<number[]>
> {
  return apiService.get<number[]>(`/api/cloud/item-sheet/label-update/printed`);
}

export async function markLabelUpdateSheetPrinted(
  id: number | string,
): Promise<ApiResponse<PrintedLabelUpdateSheetResult>> {
  return apiService.post<PrintedLabelUpdateSheetResult>(
    `/api/cloud/item-sheet/label-update/${id}/printed`,
  );
}

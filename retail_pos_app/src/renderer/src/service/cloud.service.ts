import apiService, { ApiResponse } from "../libs/api";
import { CloudItemSheet, CloudPost } from "../types/models";

export type PrintedLabelUpdateSheetResult = {
  sheetId: number;
};

export async function migrateDataFromCloudServer(): Promise<ApiResponse<void>> {
  return apiService.post<void>(`/api/cloud/migrate/item`);
}

/**
 * Customer display: the newest five published posts (D-P4-18). The store server forwards the
 * limit to CRM and drops ended/archived posts, so fewer than five may come back.
 */
export const CUSTOMER_DISPLAY_POST_LIMIT = 5;

export async function getCloudPosts(
  limit: number = CUSTOMER_DISPLAY_POST_LIMIT,
): Promise<ApiResponse<CloudPost[]>> {
  return apiService.get<CloudPost[]>(`/api/cloud/post`, {
    limit: String(limit),
  });
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

import { StoreSetting } from "../types/models";
import apiService, { ApiResponse } from "../libs/api";

export const getStoreSetting = async (): Promise<
  ApiResponse<StoreSetting>
> => {
  return await apiService.get<StoreSetting>("/api/store");
};

export const updateStoreSetting = async (
  data: Partial<StoreSetting>,
): Promise<ApiResponse<StoreSetting>> => {
  return await apiService.post<StoreSetting>("/api/store", data);
};

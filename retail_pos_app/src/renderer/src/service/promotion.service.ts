import apiService, { ApiResponse } from "../libs/api";
import { Promotion } from "../types/models";

export const getAvailablePromotions = async (): Promise<
  ApiResponse<Promotion[]>
> => {
  return await apiService.get<Promotion[]>("/api/promotion/available");
};

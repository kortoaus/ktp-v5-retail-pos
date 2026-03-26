import apiService, { ApiResponse } from "../libs/api";
import { Promotion } from "../types/models";

export interface PromotionAllowedItem {
  id: number;
  name_en: string;
  barcode: string;
  uom: string;
}

export interface PromotionDetail extends Promotion {
  allowedItems: PromotionAllowedItem[];
}

export const getAvailablePromotions = async (): Promise<
  ApiResponse<Promotion[]>
> => {
  return await apiService.get<Promotion[]>("/api/promotion/available");
};

export async function searchPromotions(
  keyword: string,
  page = 1,
  limit = 20,
): Promise<ApiResponse<Promotion[]>> {
  const params = new URLSearchParams({
    keyword,
    page: String(page),
    limit: String(limit),
  });
  return apiService.get<Promotion[]>(`/api/promotion/search?${params}`);
}

export async function getPromotionById(
  id: number,
): Promise<ApiResponse<PromotionDetail>> {
  return apiService.get<PromotionDetail>(`/api/promotion/${id}`);
}

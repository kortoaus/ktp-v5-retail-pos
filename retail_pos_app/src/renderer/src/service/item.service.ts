import apiService, { ApiResponse } from "../libs/api";
import { Item } from "../types/models";

export async function searchItemByBarcode(
  barcode: string,
): Promise<ApiResponse<Item>> {
  return apiService.get<Item>(`/api/item/search/barcode?barcode=${barcode}`);
}

export async function searchItemsByKeyword(
  keyword: string,
  page = 1,
  limit = 20,
): Promise<ApiResponse<Item[]>> {
  const params = new URLSearchParams({
    keyword,
    page: String(page),
    limit: String(limit),
  });
  return apiService.get<Item[]>(`/api/item/search/keyword?${params}`);
}

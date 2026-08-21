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

export async function getItemsByIds(ids: number[]): Promise<ApiResponse<Item[]>> {
  return apiService.post<Item[]>(`/api/item/search/ids`, { ids });
}

// 단건 id 조회 — S3 주문 로드가 주문 라인 sourceItemId 로 로컬 카탈로그를
// 찾을 때 사용 (로컬 id = 클라우드 id, 다운싱크 upsert 관례).
export async function searchItemById(id: number): Promise<ApiResponse<Item>> {
  return apiService.get<Item>(`/api/item/search/id/${id}`);
}

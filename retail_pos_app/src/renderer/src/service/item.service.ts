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

/**
 * Scale-only keyword search — the `/scale` station's item browser.
 *
 * Same service as `/search/keyword` behind the scenes, with `isScale: true`
 * added to the where clause (`item.search.service.ts searchItemsService`, the
 * `scaleOnly` flag). The route predates this screen: it was built for the
 * retired `ktpv5-scale` Android terminal and is reused rather than rebuilt.
 *
 * `brandId` is the brand filter; omitting it searches every brand.
 */
export async function searchScaleItemsByKeyword(
  keyword: string,
  page = 1,
  limit = 20,
  brandId?: number | null,
): Promise<ApiResponse<Item[]>> {
  const params = new URLSearchParams({
    keyword,
    page: String(page),
    limit: String(limit),
  });
  if (brandId != null) params.set("brandId", String(brandId));
  return apiService.get<Item[]>(`/api/item/search/keyword/scale?${params}`);
}

export async function getItemsByIds(ids: number[]): Promise<ApiResponse<Item[]>> {
  return apiService.post<Item[]>(`/api/item/search/ids`, { ids });
}

// 단건 id 조회 — S3 주문 로드가 주문 라인 sourceItemId 로 로컬 카탈로그를
// 찾을 때 사용 (로컬 id = 클라우드 id, 다운싱크 upsert 관례).
export async function searchItemById(id: number): Promise<ApiResponse<Item>> {
  return apiService.get<Item>(`/api/item/search/id/${id}`);
}

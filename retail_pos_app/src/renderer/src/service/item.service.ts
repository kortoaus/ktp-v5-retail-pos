import apiService, { ApiResponse } from "../libs/api";
import { Item } from "../types/models";

export async function searchItemByBarcode(
  barcode: string,
): Promise<ApiResponse<Item>> {
  return apiService.get<Item>(`/api/item/search/barcode?barcode=${barcode}`);
}

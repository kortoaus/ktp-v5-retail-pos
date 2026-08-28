/**
 * Brand lookup — first consumer of `GET /api/brand/*` in this app.
 *
 * The routes have existed on `retail_pos_server` since the catalogue down-sync
 * was written and were listed in the repo `CLAUDE.md` as unused surface. The
 * `/scale` station's brand filter is what finally reads them.
 */

import apiService, { ApiResponse } from "../libs/api";
import { Brand } from "../types/models";

export async function searchBrands(
  keyword = "",
  page = 1,
  limit = 20,
): Promise<ApiResponse<Brand[]>> {
  const params = new URLSearchParams({
    keyword,
    page: String(page),
    limit: String(limit),
  });
  return apiService.get<Brand[]>(`/api/brand/search?${params}`);
}

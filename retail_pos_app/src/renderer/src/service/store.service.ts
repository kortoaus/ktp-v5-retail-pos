import { StoreLabelSetting, StoreSetting } from "../types/models";
import apiService, { ApiResponse } from "../libs/api";

/**
 * The store block a 60 × 40 scale label prints in its footer.
 *
 * A route of its own rather than a slice of `GET /api/store`, because the
 * server already composes the one-line address there
 * (`store.service.ts formatStoreLabelAddress`: address1, address2, suburb,
 * state, postcode, blanks dropped) and duplicating that join in the renderer
 * is how the two drift. Listed as unused surface in the repo `CLAUDE.md` until
 * the `/scale` station read it.
 */
export const getStoreLabelSetting = async (): Promise<
  ApiResponse<StoreLabelSetting>
> => {
  return await apiService.get<StoreLabelSetting>("/api/store/label");
};

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

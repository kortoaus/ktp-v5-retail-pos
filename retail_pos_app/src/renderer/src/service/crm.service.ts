import apiService, { ApiResponse } from "../libs/api";
import { Member } from "../types/models";

export async function searchMember(
  phone: string,
): Promise<ApiResponse<Member>> {
  return apiService.post<Member>("/api/crm/member/search", { phone });
}

export async function createMember(data: {
  phone: string;
  name: string;
}): Promise<ApiResponse<Member>> {
  return apiService.post<Member>("/api/crm/member/create", data);
}

import apiService, { ApiResponse } from "../libs/api";
import { Member } from "../types/models";

export async function searchMemberByPhone(
  phone: string,
): Promise<ApiResponse<Member>> {
  return apiService.post<Member>("/api/crm/member/search/phone", { phone });
}

export async function searchMemberById(
  memberId: string,
): Promise<ApiResponse<Member>> {
  return apiService.post<Member>("/api/crm/member/search/id", { memberId });
}

export async function createMember(data: {
  phone: string;
  name: string;
}): Promise<ApiResponse<Member>> {
  return apiService.post<Member>("/api/crm/member/create", data);
}

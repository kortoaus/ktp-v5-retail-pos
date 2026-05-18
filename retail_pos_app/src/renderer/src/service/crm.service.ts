import apiService, { ApiResponse } from "../libs/api";
import { Member } from "../types/models";

export interface MemberSearchResult {
  id: string;
  companyId: number;
  phoneLast3: string | null;
  name: string;
  level: number;
  points: number;
}

export async function searchMemberByPhone(
  phone: string,
): Promise<ApiResponse<Member>> {
  return apiService.post<Member>("/api/crm/member/search/phone", { phone });
}

export async function searchMembersByKeyword(
  keyword: string,
): Promise<ApiResponse<MemberSearchResult[]>> {
  return apiService.post<MemberSearchResult[]>(
    "/api/crm/member/search/keyword",
    { keyword },
  );
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

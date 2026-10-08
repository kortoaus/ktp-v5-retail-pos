import { User } from "../types/models";
import apiService, { ApiResponse } from "../libs/api";

export const getUserByCode = async (
  code: string,
): Promise<ApiResponse<User | null>> => {
  const response = await apiService.get<User | null>(
    `/api/user/code?code=${code}`,
  );
  // R-1: the server proves the code and issues the staff session; the till
  // stores it as-is. Fallback only for a store server that predates T-12 (no
  // `token` in the response) so a till that updates before its server still
  // works; that server accepts the legacy shape, and an updated server always
  // sends `token`.
  if (response.ok && response.result) {
    apiService.setToken(
      response.token ?? `${response.result.id}%%%${Date.now()}`,
    );
  }

  return response;
};

export const getMe = async (): Promise<ApiResponse<User | null>> => {
  return await apiService.get<User | null>("/api/user/me");
};

export const getUsers = async (qs?: string): Promise<ApiResponse<User[]>> => {
  const url = qs ? `/api/user${qs}` : "/api/user";
  return await apiService.get<User[]>(url);
};

export const getPublicUsers = async (
  qs?: string,
): Promise<ApiResponse<User[]>> => {
  const url = qs ? `/api/user/public${qs}` : "/api/user/public";
  return await apiService.get<User[]>(url);
};

export const getUserById = async (id: number): Promise<ApiResponse<User>> => {
  return await apiService.get<User>(`/api/user/${id}`);
};

export const upsertUser = async (data: any): Promise<ApiResponse<User>> => {
  return await apiService.post<User>("/api/user", data);
};

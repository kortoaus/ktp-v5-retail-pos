import { User } from "../types/models";
import apiService, { ApiResponse } from "../libs/api";

export const getUserByCode = async (
  code: string,
): Promise<ApiResponse<User | null>> => {
  const response = await apiService.get<User | null>(
    `/api/user/code?code=${code}`,
  );
  if (response.ok && response.result) {
    apiService.setTokens(
      `${response.result.id}%%%${Date.now()}`,
      `${response.result.id}%%%${Date.now()}`,
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

export const getUserById = async (id: number): Promise<ApiResponse<User>> => {
  return await apiService.get<User>(`/api/user/${id}`);
};

export const upsertUser = async (data: any): Promise<ApiResponse<User>> => {
  return await apiService.post<User>("/api/user", data);
};

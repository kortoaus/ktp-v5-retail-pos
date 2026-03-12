import apiService, { ApiResponse } from "../libs/api";
import { UserVoucher } from "../types/models";

const endpoint = "/api/user/voucher";

export const getUserVouchersByUserIds = async (
  userIds: number[],
): Promise<ApiResponse<UserVoucher[]>> => {
  return await apiService.post<UserVoucher[]>(
    `${endpoint}/search/by-user-ids`,
    { userIds },
  );
};

export const issueUserDailyVoucher = async (
  userId: number,
): Promise<ApiResponse<UserVoucher>> => {
  return await apiService.post<UserVoucher>(`${endpoint}/issue/daily`, {
    userId,
  });
};

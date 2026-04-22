import apiService, { ApiResponse } from "../libs/api";

export type Voucher = {
  id: number;
  userId: number;
  kind: string;
  initAmount: number;
  balance: number;
  validFrom: string;
  validTo: string;
  status: "ACTIVE" | "EXPIRED" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
};

export type DailyVoucherRow = {
  id: number; // userId
  name: string;
  code: string;
  voucher: Voucher | null;
};

export async function getDailyVouchers(): Promise<
  ApiResponse<DailyVoucherRow[]>
> {
  return apiService.get<DailyVoucherRow[]>("/api/voucher/daily");
}

export async function issueDailyVoucher(
  userId: number,
): Promise<ApiResponse<Voucher>> {
  return apiService.post<Voucher>("/api/voucher/daily/issue", { userId });
}

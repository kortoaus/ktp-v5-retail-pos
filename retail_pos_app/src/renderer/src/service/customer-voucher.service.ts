import apiService, { ApiResponse } from "../libs/api";

export type CustomerVoucher = {
  id: number;
  memberId: string;
  serial: string;
  kind: "POINT_EXCHANGE" | "REFUND";
  initAmount: number;
  balance: number;
  status: "ACTIVE" | "EXPIRED" | "ARCHIVED";
  validFrom: string;
  validTo: string;
  label: string;
};

export type CustomerVoucherIssueResult = {
  voucher: CustomerVoucher;
  memberPoints: number;
};

export async function getValidCustomerVouchers(
  memberId: string,
): Promise<ApiResponse<CustomerVoucher[]>> {
  return apiService.get<CustomerVoucher[]>("/api/customer-voucher/valid", {
    memberId,
  });
}

export async function issueCustomerVoucher(
  memberId: string,
): Promise<ApiResponse<CustomerVoucherIssueResult>> {
  return apiService.post<CustomerVoucherIssueResult>(
    "/api/customer-voucher/issue",
    { memberId },
  );
}

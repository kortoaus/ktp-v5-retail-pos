import apiService, { ApiResponse } from "../libs/api";
import {
  customerVoucherIssueAttemptKey,
  sendWithOperation,
} from "../libs/operation-id";

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
  // null only on a replay when CRM could not read the member's balance.
  memberPoints: number | null;
  replayed?: boolean;
};

export async function getValidCustomerVouchers(
  memberId: string,
): Promise<ApiResponse<CustomerVoucher[]>> {
  return apiService.get<CustomerVoucher[]>("/api/customer-voucher/valid", {
    memberId,
  });
}

// T-17 (V-5) — the exchange press carries its attempt's operationId
// (libs/operation-id.ts, key cv-issue:<memberId>), kept until the server
// answers ok or a settling 409: a retry after a lost answer replays the
// voucher CRM already issued instead of deducting points twice.
export async function issueCustomerVoucher(
  memberId: string,
): Promise<ApiResponse<CustomerVoucherIssueResult>> {
  return sendWithOperation(customerVoucherIssueAttemptKey(memberId), (operationId) =>
    apiService.post<CustomerVoucherIssueResult>("/api/customer-voucher/issue", {
      memberId,
      operationId,
    }),
  );
}

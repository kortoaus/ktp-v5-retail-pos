import apiService, { type ApiResponse } from "../libs/api";
import {
  customerVoucherIssueAttemptKey,
  pendingOperation,
  sendWithOperation,
} from "../libs/operation-id";
import {
  PENDING_EXCHANGE_NOTICE,
  pendingVoucherIssueFromAttempt,
  type PendingVoucherIssue,
} from "../libs/customer-voucher-issue";

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
// retail-delivery D-24 (+ review round 1): one pending exchange per member.
// The chosen tier (`amount`, cents) is stored with the attempt; while it is
// unsettled a new exchange is refused locally and only
// resumeCustomerVoucherIssue resends it (same operationId, stored amount —
// CRM answers 400 "requestId conflict" to the same id with another amount).

// The member's unsettled exchange, or null.
export function pendingCustomerVoucherIssue(memberId: string): PendingVoucherIssue | null {
  return pendingVoucherIssueFromAttempt(
    pendingOperation(customerVoucherIssueAttemptKey(memberId)),
  );
}

function refusedLocally(msg: string): ApiResponse<CustomerVoucherIssueResult> {
  return { ok: false, status: 409, msg, result: null, paging: null };
}

// A new exchange of `amount` cents (1000/2500/5000/10000).
export async function issueCustomerVoucher(
  memberId: string,
  amount: number,
): Promise<ApiResponse<CustomerVoucherIssueResult>> {
  const attemptKey = customerVoucherIssueAttemptKey(memberId);
  if (pendingOperation(attemptKey)) return refusedLocally(PENDING_EXCHANGE_NOTICE);
  return sendWithOperation(
    attemptKey,
    (operationId) =>
      apiService.post<CustomerVoucherIssueResult>("/api/customer-voucher/issue", {
        memberId,
        amount,
        operationId,
      }),
    { amount },
  );
}

// Finish the member's unsettled exchange: same operationId, stored amount;
// a record from the previous release has none → no amount sent (CRM: $10).
export async function resumeCustomerVoucherIssue(
  memberId: string,
): Promise<ApiResponse<CustomerVoucherIssueResult>> {
  const pending = pendingCustomerVoucherIssue(memberId);
  if (!pending) return refusedLocally("No unfinished exchange for this member");
  return sendWithOperation(customerVoucherIssueAttemptKey(memberId), (operationId) =>
    apiService.post<CustomerVoucherIssueResult>(
      "/api/customer-voucher/issue",
      pending.amount === undefined
        ? { memberId, operationId }
        : { memberId, amount: pending.amount, operationId },
    ),
  );
}

import { crmApiService } from "../../libs/cloud.api";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  UnauthorizedException,
} from "../../libs/exceptions";
import type { CustomerVoucherWire } from "./customer-voucher.types";

function requireOk<T>(res: {
  ok: boolean;
  msg?: string;
  status?: number;
  result?: T | null;
}): T {
  if (!res.ok || res.result == null) {
    const msg = res.msg || "CRM customer voucher request failed";
    if (res.status === 400 || res.status === 404) {
      throw new BadRequestException(msg);
    }
    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException(msg);
    }
    if (res.status === 0) {
      throw new InternalServerException(
        "CRM customer voucher service unavailable",
      );
    }
    if (res.status && res.status >= 500) {
      throw new InternalServerException(
        "CRM customer voucher service unavailable",
      );
    }
    throw new HttpException(res.status ?? 502, msg);
  }
  return res.result;
}

export async function getValidCustomerVouchersService(memberId: string) {
  const res = await crmApiService.get<CustomerVoucherWire[]>(
    "/device/customer-voucher/valid",
    { memberId },
  );
  return { ok: true, result: requireOk(res) };
}

// CRM requestId for a till's points→voucher exchange press (T-17, V-5).
export function customerVoucherIssueRequestId(operationId: string): string {
  return `${operationId}:cv-issue`;
}

// D-24 (retail-delivery T-17): points→voucher exchange tiers in cents — 1,000 P → $10,
// 2,500 P → $25, 5,000 P → $50, 10,000 P → $100. An absent amount means $10 so tills on
// the previous release keep working; anything else is rejected before CRM is called.
export const CUSTOMER_VOUCHER_ISSUE_AMOUNTS = [1000, 2500, 5000, 10000] as const;
export const DEFAULT_CUSTOMER_VOUCHER_ISSUE_AMOUNT = 1000;

export function normalizeCustomerVoucherIssueAmount(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_CUSTOMER_VOUCHER_ISSUE_AMOUNT;
  }
  if (
    typeof value !== "number" ||
    !(CUSTOMER_VOUCHER_ISSUE_AMOUNTS as readonly number[]).includes(value)
  ) {
    throw new BadRequestException("Invalid voucher amount");
  }
  return value;
}

// T-17 (V-5): a till sends `operationId` (one per exchange press, kept until
// answered); CRM gets `requestId` = `<operationId>:cv-issue` and replays the
// voucher it already issued on a retry instead of deducting points twice.
// Without operationId (Runner, old tills) there is no requestId.
// D-24: `amount` (cents, one of CUSTOMER_VOUCHER_ISSUE_AMOUNTS) is always
// forwarded; CRM compares it on a requestId replay.
export async function issueCustomerVoucherService(
  memberId: string,
  operationId: string | null = null,
  amount: number = DEFAULT_CUSTOMER_VOUCHER_ISSUE_AMOUNT,
  crm: Pick<typeof crmApiService, "post"> = crmApiService,
) {
  const body: { memberId: string; amount: number; requestId?: string } = {
    memberId,
    amount: normalizeCustomerVoucherIssueAmount(amount),
  };
  if (operationId) body.requestId = customerVoucherIssueRequestId(operationId);
  const res = await crm.post<{
    voucher: CustomerVoucherWire;
    memberPoints: number | null;
    replayed?: boolean;
  }>("/device/customer-voucher/issue", body);
  return { ok: true, result: requireOk(res) };
}

// Sale redeem / void and refund issue moved to customer-voucher.operation.ts
// (T-15: durable ledger + reconciliation instead of in-memory compensation).

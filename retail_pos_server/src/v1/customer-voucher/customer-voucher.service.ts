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

// T-17 (V-5): a till sends `operationId` (one per exchange press, kept until
// answered); CRM gets `requestId` = `<operationId>:cv-issue` and replays the
// voucher it already issued on a retry instead of deducting points twice.
// Without operationId (Runner, old tills) the body is unchanged — no requestId.
export async function issueCustomerVoucherService(
  memberId: string,
  operationId: string | null = null,
  crm: Pick<typeof crmApiService, "post"> = crmApiService,
) {
  const body: { memberId: string; requestId?: string } = { memberId };
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

export function customerVoucherFailure(message: string, cause: unknown): never {
  console.error(message, cause);
  throw new InternalServerException(message);
}

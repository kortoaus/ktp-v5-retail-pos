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

export async function issueCustomerVoucherService(memberId: string) {
  const res = await crmApiService.post<{
    voucher: CustomerVoucherWire;
    memberPoints: number;
  }>("/device/customer-voucher/issue", { memberId });
  return { ok: true, result: requireOk(res) };
}

// Sale redeem / void and refund issue moved to customer-voucher.operation.ts
// (T-15: durable ledger + reconciliation instead of in-memory compensation).

export function customerVoucherFailure(message: string, cause: unknown): never {
  console.error(message, cause);
  throw new InternalServerException(message);
}

import { crmApiService } from "../../libs/cloud.api";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  UnauthorizedException,
} from "../../libs/exceptions";
import type {
  CustomerVoucherRedeemRequest,
  CustomerVoucherRefundIssueRequest,
  CustomerVoucherWire,
} from "./customer-voucher.types";

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
    if (res.status && res.status >= 500) {
      throw new InternalServerException(msg);
    }
    if (res.status === 0) {
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

export async function redeemCustomerVoucherService(
  input: CustomerVoucherRedeemRequest,
) {
  const res = await crmApiService.post("/device/customer-voucher/redeem", input);
  requireOk(res);
  return {
    requestId: input.requestId,
    voucherId: input.voucherId,
    amount: input.amount,
  };
}

export async function voidCustomerVoucherRedeemService({
  redeemRequestId,
  requestId,
  note,
}: {
  redeemRequestId: string;
  requestId: string;
  note?: string | null;
}) {
  const res = await crmApiService.post("/device/customer-voucher/redeem/void", {
    redeemRequestId,
    requestId,
    note: note ?? null,
  });
  requireOk(res);
  return { ok: true, result: { requestId, redeemRequestId } };
}

export async function issueRefundCustomerVoucherService(
  input: CustomerVoucherRefundIssueRequest,
) {
  const res = await crmApiService.post<{ voucher: CustomerVoucherWire }>(
    "/device/customer-voucher/refund-issue",
    input,
  );
  return { ok: true, result: requireOk(res).voucher };
}

export function customerVoucherFailure(message: string, cause: unknown): never {
  console.error(message, cause);
  throw new InternalServerException(message);
}

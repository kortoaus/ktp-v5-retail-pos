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

export interface RedeemedCustomerVoucher {
  redeemRequestId: string;
  voucherId: number;
  amount: number;
}

export interface CustomerVoucherRedeemVoidOutcome
  extends RedeemedCustomerVoucher {
  ok: boolean;
  error?: unknown;
}

export class CustomerVoucherRedeemVoidFailedError extends Error {
  constructor(public readonly outcomes: CustomerVoucherRedeemVoidOutcome[]) {
    super("one or more customer voucher redeem voids failed");
  }
}

export async function redeemCustomerVouchersForSale({
  invoiceRequestId,
  memberId,
  payments,
}: {
  invoiceRequestId: string;
  memberId: string;
  payments: Array<{
    type: string;
    amount: number;
    entityType?: string;
    entityId?: number;
    entityLabel?: string;
  }>;
}): Promise<RedeemedCustomerVoucher[]> {
  const customerVoucherPayments = payments.filter(
    (payment) =>
      payment.type === "VOUCHER" &&
      payment.entityType === "customer-voucher",
  );

  const seen = new Set<number>();
  for (const payment of customerVoucherPayments) {
    if (payment.entityId == null) {
      throw new BadRequestException("customer voucher entityId missing");
    }
    if (seen.has(payment.entityId)) {
      throw new BadRequestException(
        `customer voucher ${payment.entityId} used more than once`,
      );
    }
    seen.add(payment.entityId);
  }

  const customerVouchers = customerVoucherPayments.filter(
    (payment): payment is typeof payment & { entityId: number } =>
      payment.entityId != null,
  );

  const redeemed: RedeemedCustomerVoucher[] = [];
  for (const payment of customerVouchers) {
    const voucherId = payment.entityId;
    const redeemRequestId = `${invoiceRequestId}:cv:${voucherId}:${payment.amount}`;
    try {
      await redeemCustomerVoucherService({
        memberId,
        voucherId,
        amount: payment.amount,
        requestId: redeemRequestId,
        entityType: "pos-sale-request",
        entityId: invoiceRequestId,
        entitySerial: null,
        note: payment.entityLabel ?? null,
      });
    } catch (redeemError) {
      if (redeemed.length > 0) {
        try {
          await voidRedeemedCustomerVouchersForSale({
            redeemed,
            reason: "POS customer voucher sale redeem failed after partial success",
          });
        } catch (voidError) {
          console.error("[customer-voucher] partial redeem void failed", {
            voidError,
            redeemed,
            memberId,
            invoiceRequestId,
            failedRedeem: {
              redeemRequestId,
              voucherId,
              amount: payment.amount,
            },
          });
        }
      }
      throw redeemError;
    }
    redeemed.push({ redeemRequestId, voucherId, amount: payment.amount });
  }
  return redeemed;
}

export async function voidRedeemedCustomerVouchersForSale({
  redeemed,
  reason,
}: {
  redeemed: RedeemedCustomerVoucher[];
  reason: string;
}): Promise<CustomerVoucherRedeemVoidOutcome[]> {
  const outcomes: CustomerVoucherRedeemVoidOutcome[] = [];
  for (const item of redeemed) {
    try {
      await voidCustomerVoucherRedeemService({
        redeemRequestId: item.redeemRequestId,
        requestId: `${item.redeemRequestId}:void`,
        note: reason,
      });
      outcomes.push({ ...item, ok: true });
    } catch (error) {
      outcomes.push({ ...item, ok: false, error });
    }
  }
  if (outcomes.some((outcome) => !outcome.ok)) {
    throw new CustomerVoucherRedeemVoidFailedError(outcomes);
  }
  return outcomes;
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

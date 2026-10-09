import { crmApiService, type ApiResponse } from "../../libs/cloud.api";
import type {
  CustomerVoucherRedeemRequest,
  CustomerVoucherRefundIssueRequest,
  CustomerVoucherWire,
} from "./customer-voucher.types";

// ══════════════════════════════════════════════════════════════════════════════
// CRM customer-voucher client with a three-way outcome (T-15, platform/D-10).
//
//   ok        CRM answered ok — the effect happened (or was replayed).
//   rejected  CRM definitively refused (400/401/403/404/409) — nothing happened.
//   unknown   no answer / timeout / 5xx — the effect may or may not have
//             happened. Never assumed either way: the ledger row goes
//             UNRESOLVED and the reconciler asks CRM for the effective state.
//
// A CRM "requestId conflict" 400 is classed unknown: an event already owns the
// key, so something did happen under it.
// The sale/refund services and the reconciler take this interface so tests
// can pass a fake CRM (no network in `npm test`).
// ══════════════════════════════════════════════════════════════════════════════

export type CrmOutcome<T> =
  | { kind: "ok"; result: T }
  | { kind: "rejected"; status: number; msg: string }
  | { kind: "unknown"; status: number; msg: string };

export interface CrmRedeemResult {
  eventId: number | null;
  voucherId: number;
  // T-25 (V-7): CRM's own label for the redeemed voucher (serial + expiry) —
  // the receipt label comes from here, never from the till's payload.
  voucherLabel: string | null;
  replayed: boolean;
  // V-12: true when CRM replays a redeem that was voided since — not payment.
  voided: boolean;
}

export interface CrmRefundIssueResult {
  voucher: CustomerVoucherWire;
  eventId: number | null;
  replayed: boolean;
  voided: boolean;
}

export interface CrmEventResult {
  eventId: number | null;
}

export type CrmOperationStateName =
  | "not_found"
  | "redeemed"
  | "voided"
  | "issued"
  | "issue_voided";

export interface CrmOperationState {
  state: CrmOperationStateName;
  eventId: number | null;
  voucherId: number | null;
  amount: number | null;
}

export interface CustomerVoucherCrm {
  redeem(input: CustomerVoucherRedeemRequest): Promise<CrmOutcome<CrmRedeemResult>>;
  voidRedeem(input: {
    redeemRequestId: string;
    requestId: string;
    note?: string | null;
  }): Promise<CrmOutcome<CrmEventResult>>;
  issueRefund(
    input: CustomerVoucherRefundIssueRequest,
  ): Promise<CrmOutcome<CrmRefundIssueResult>>;
  voidRefundIssue(input: {
    entityType: string;
    entityId: string;
    requestId: string;
    note?: string | null;
  }): Promise<CrmOutcome<CrmEventResult>>;
  getOperation(
    requestId: string,
    entityType?: string,
  ): Promise<CrmOutcome<CrmOperationState>>;
  // V-6 reachability probe: one cheap authenticated read.
  ping(memberId: string): Promise<CrmOutcome<true>>;
}

const DEFINITIVE_REJECTIONS = new Set([400, 401, 403, 404, 409, 422]);

export function classifyCrmResponse<T>(
  res: ApiResponse<unknown>,
  read: (result: unknown) => T,
): CrmOutcome<T> {
  const msg = res.msg || res.message || "CRM customer voucher request failed";
  if (res.ok && res.result != null) return { kind: "ok", result: read(res.result) };
  const status = res.status ?? 0;
  if (DEFINITIVE_REJECTIONS.has(status) && !/requestId conflict|issue conflict/i.test(msg))
    return { kind: "rejected", status, msg };
  return { kind: "unknown", status, msg };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

export const crmCustomerVoucherClient: CustomerVoucherCrm = {
  async redeem(input) {
    const res = await crmApiService.post("/device/customer-voucher/redeem", input);
    return classifyCrmResponse(res, (result) => {
      const r = obj(result);
      return {
        eventId: num(obj(r.event).id),
        voucherId: num(obj(r.voucher).id) ?? input.voucherId,
        voucherLabel: str(obj(r.voucher).label),
        replayed: r.replayed === true,
        // CRM before T-15 omits the flag: absent = not voided (old semantics).
        voided: r.voided === true,
      };
    });
  },
  async voidRedeem(input) {
    const res = await crmApiService.post("/device/customer-voucher/redeem/void", {
      redeemRequestId: input.redeemRequestId,
      requestId: input.requestId,
      note: input.note ?? null,
    });
    return classifyCrmResponse(res, (result) => ({
      eventId: num(obj(obj(result).event).id),
    }));
  },
  async issueRefund(input) {
    const res = await crmApiService.post("/device/customer-voucher/refund-issue", input);
    return classifyCrmResponse(res, (result) => {
      const r = obj(result);
      return {
        voucher: r.voucher as CustomerVoucherWire,
        eventId: num(r.eventId),
        replayed: r.replayed === true,
        voided: r.voided === true,
      };
    });
  },
  async voidRefundIssue(input) {
    const res = await crmApiService.post(
      "/device/customer-voucher/refund-issue/void",
      {
        entityType: input.entityType,
        entityId: input.entityId,
        requestId: input.requestId,
        note: input.note ?? null,
      },
    );
    return classifyCrmResponse(res, (result) => ({
      eventId: num(obj(obj(result).event).id),
    }));
  },
  async getOperation(requestId, entityType) {
    const res = await crmApiService.get("/device/customer-voucher/operation", {
      requestId,
      ...(entityType ? { entityType } : {}),
    });
    return classifyCrmResponse(res, (result) => {
      const r = obj(result);
      return {
        state: r.state as CrmOperationStateName,
        eventId: num(r.eventId),
        voucherId: num(r.voucherId),
        amount: num(r.amount),
      };
    });
  },
  async ping(memberId) {
    const res = await crmApiService.get("/device/customer-voucher/valid", {
      memberId,
    });
    // An empty list is still an answer.
    if (res.ok) return { kind: "ok", result: true };
    return classifyCrmResponse(res, () => true as const);
  },
};

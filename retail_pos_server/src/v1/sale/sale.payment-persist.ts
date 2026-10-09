import type { PaymentPayload } from "./sale.types";

// T-25 (V-7 / O-17; D-14 review P2) — a CRM event id on a stored payment comes
// only from the server's own CRM result (applyCrmRedeemResults for a sale,
// substituteIssuedVoucher for a refund). Every incoming payload is stripped of
// any client-sent `crmEventId` first, and the persist mapping keeps the id
// only on a real customer-voucher tender (type VOUCHER).

export function isCustomerVoucherTender(pm: {
  type: string;
  entityType?: string | null;
}): boolean {
  return pm.type === "VOUCHER" && pm.entityType === "customer-voucher";
}

export function stripCrmEventId<P extends PaymentPayload>(pm: P): Omit<P, "crmEventId"> {
  const { crmEventId: _clientValue, ...rest } = pm;
  return rest;
}

export function withoutClientCrmEventIds<T extends { payments: PaymentPayload[] }>(payload: T): T {
  if (!Array.isArray(payload.payments)) return payload;
  return { ...payload, payments: payload.payments.map((pm) => stripCrmEventId(pm)) };
}

export function paymentCreateData(pm: PaymentPayload) {
  return {
    type: pm.type,
    amount: pm.amount,
    entityType: pm.entityType ?? null,
    entityId: pm.entityId ?? null,
    entityLabel: pm.entityLabel ?? null,
    crmEventId: isCustomerVoucherTender(pm) ? (pm.crmEventId ?? null) : null,
  };
}

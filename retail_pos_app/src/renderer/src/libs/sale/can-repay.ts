// canRepay — SaleInvoice 가 "repay" 대상으로 적합한지 판정.
//
// 서버도 동일 조건을 재검증함 (sale.repay.service.ts). Client 는 UX 게이트
// (버튼 노출/숨김, 10분 타이머) 만 담당.
//
// 조건:
//   1. type === 'SALE'
//   2. refunds(type=REFUND 필터 후) 자식 없음 — 환불 흔적 있으면 repay 차단
//   3. invoice.shiftId === currentShiftId
//   4. now - invoice.createdAt < 10분
//   5. 원본 payments 에 customer-voucher 없음 (D-21 확장 — CRM 연동 전까지 차단)

import type { SaleInvoiceDetail } from "../../service/sale.service";

export const REPAY_TIME_LIMIT_MS = 10 * 60 * 1000;

export type RepayBlockReason =
  | "not-sale"
  | "has-refund"
  | "different-shift"
  | "expired"
  | "customer-voucher";

export interface CanRepayResult {
  ok: boolean;
  reason?: RepayBlockReason;
  expiresAt?: number; // ms epoch — inv.createdAt + 10min (UI 타이머용)
}

export function canRepay(
  invoice: SaleInvoiceDetail,
  currentShiftId: number | null | undefined,
  now: number,
): CanRepayResult {
  if (invoice.type !== "SALE") return { ok: false, reason: "not-sale" };

  // 서버가 refunds 에 대해 이미 `type=REFUND` source filter 를 적용.
  // 그래도 repay 로 생성된 새 SALE 이 같은 originalInvoiceId 로 자식으로 들어올
  // 수 있어 클라도 명시 필터 (R5 파급 처리).
  const refundChildren = (invoice.refunds ?? []).filter(
    (r) => r.type === "REFUND",
  );
  if (refundChildren.length > 0)
    return { ok: false, reason: "has-refund" };

  if (currentShiftId == null || invoice.shiftId !== currentShiftId)
    return { ok: false, reason: "different-shift" };

  const createdAt = new Date(invoice.createdAt).valueOf();
  const expiresAt = createdAt + REPAY_TIME_LIMIT_MS;
  if (now >= expiresAt) return { ok: false, reason: "expired", expiresAt };

  if (invoice.payments.some((p) => p.entityType === "customer-voucher"))
    return { ok: false, reason: "customer-voucher" };

  return { ok: true, expiresAt };
}

// Refund payload builder — UI state (selections + tenderAmounts) 를 서버
// RefundCreatePayload 로 변환. 서버가 금액 수식은 재계산하므로 여기서는
// intent 만 싣는다 (refund_qty + 결제 amount).

import type {
  SaleInvoiceDetail,
  SaleInvoicePaymentItem,
} from "../../service/sale.service";
import type { FlatTenderKey, TenderCapEntry } from "./compute";
import type {
  RefundCreatePayload,
  RefundPaymentPayload,
  RefundRowPayload,
} from "./payload.types";

// UI 측 selections: originalRowId → refund_qty
export type RefundSelection = Record<number, number>;
// UI 측 tender 입력: keyStr → amount
export type TenderAmountMap = Record<string, number>;

export function buildRefundPayload(
  invoice: SaleInvoiceDetail,
  selections: RefundSelection,
  tenderAmounts: TenderAmountMap,
  caps: TenderCapEntry[],
  note?: string,
): RefundCreatePayload {
  // Rows — refund_qty > 0 만 포함
  const rows: RefundRowPayload[] = [];
  for (const row of invoice.rows) {
    const q = selections[row.id] ?? 0;
    if (q <= 0) continue;
    rows.push({ originalInvoiceRowId: row.id, refund_qty: q });
  }

  // Payments — tender 별 amount > 0 만 포함. Voucher entityLabel 은 원본에서 그대로.
  const payments: RefundPaymentPayload[] = [];
  for (const cap of caps) {
    const amt = tenderAmounts[cap.keyStr] ?? 0;
    if (amt <= 0) continue;
    payments.push(tenderToPayment(cap.key, amt, invoice.payments));
  }

  return {
    originalInvoiceId: invoice.id,
    rows,
    payments,
    note,
  };
}

// Cap 의 FlatTenderKey → payment payload. Voucher 의 경우 원본 payment 에서
// entityLabel 을 찾아 snapshot (receipt 일관성).
function tenderToPayment(
  key: FlatTenderKey,
  amount: number,
  origPayments: SaleInvoicePaymentItem[],
): RefundPaymentPayload {
  if (key.kind === "CASH") return { type: "CASH", amount };
  if (key.kind === "CREDIT") return { type: "CREDIT", amount };
  if (key.kind === "GIFTCARD") return { type: "GIFTCARD", amount };
  // VOUCHER
  const origLabel =
    origPayments.find(
      (p) =>
        p.type === "VOUCHER" &&
        p.entityType === key.entityType &&
        p.entityId === key.entityId,
    )?.entityLabel ?? key.entityLabel ?? undefined;
  return {
    type: "VOUCHER",
    amount,
    entityType: key.entityType,
    entityId: key.entityId,
    entityLabel: origLabel ?? undefined,
  };
}

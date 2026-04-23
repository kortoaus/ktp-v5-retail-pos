// 원본 invoice 의 결제 요약 — "환불될 금액" 을 cashier 에게 시각화.
// Repay 는 한 tx 안에서 원본 전량을 역결제 하므로, 드로어에서 빠지는 현금 /
// EFTPOS 에서 취소되는 금액 / voucher 에 돌아갈 잔액 을 분명히 보여줘야 함.

import type {
  SaleInvoiceDetail,
  SaleInvoicePaymentItem,
} from "../../service/sale.service";
import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

interface Props {
  invoice: SaleInvoiceDetail;
}

const TENDER_LABEL = (p: SaleInvoicePaymentItem): string => {
  if (p.type === "CASH") return "Cash";
  if (p.type === "CREDIT") return "Credit";
  if (p.type === "GIFTCARD") return "Gift Card";
  if (p.type === "VOUCHER") {
    const kind =
      p.entityType === "user-voucher"
        ? "Staff Voucher"
        : p.entityType === "customer-voucher"
          ? "Customer Voucher"
          : "Voucher";
    return p.entityLabel ? `${kind} — ${p.entityLabel}` : kind;
  }
  return p.type;
};

export default function RepayOriginalPayments({ invoice }: Props) {
  return (
    <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-md flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-[0.15em] text-rose-700 font-bold">
        To be refunded (original)
      </div>
      <div className="space-y-1 font-mono text-sm">
        {invoice.payments.map((p) => (
          <div key={p.id} className="flex justify-between">
            <span className="text-gray-700 truncate">{TENDER_LABEL(p)}</span>
            <span>-${fmtMoney(p.amount)}</span>
          </div>
        ))}
        {invoice.rounding !== 0 && (
          <div className="flex justify-between text-xs text-gray-500">
            <span>(incl. rounding)</span>
            <span>
              {invoice.rounding > 0 ? "+" : "-"}${fmtMoney(Math.abs(invoice.rounding))}
            </span>
          </div>
        )}
        <div className="border-t border-rose-200 my-1" />
        <div className="flex justify-between font-bold">
          <span>Original Total</span>
          <span>${fmtMoney(invoice.total)}</span>
        </div>
      </div>
    </div>
  );
}

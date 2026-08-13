// OrderViewer 섹션 ④ 금액 — subtotal / surcharge / deliveryFee / total.
// 전부 서버 계산 값(cents) 표시만 — 재계산 금지.

import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";
import type { OrderDetail } from "../../service/order.service";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

export default function OrderViewerTotals({
  detail,
}: {
  detail: OrderDetail;
}) {
  return (
    <div className="p-4 border-b border-gray-300 space-y-1 text-base">
      <div className="flex justify-between">
        <span className="text-gray-500">Subtotal</span>
        <span className="font-mono">${fmtMoney(detail.subtotal)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-500">Surcharge</span>
        <span className="font-mono">${fmtMoney(detail.surchargeTotal)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-500">Delivery Fee</span>
        <span className="font-mono">${fmtMoney(detail.deliveryFee)}</span>
      </div>
      <div className="flex justify-between font-bold text-lg">
        <span>Total</span>
        <span className="font-mono">${fmtMoney(detail.total)}</span>
      </div>
    </div>
  );
}

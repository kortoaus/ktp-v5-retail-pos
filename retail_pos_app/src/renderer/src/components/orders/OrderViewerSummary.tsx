// OrderViewer 섹션 ① 요약 — 주문번호·상태·수령방식·기한(dueAt)·멤버·placedAt.
// 기능 우선(스펙 UI 원칙): 단순 라벨/값 행, 장식 없음.

import dayjsAU from "../../libs/dayjsAU";
import type { OrderDetail } from "../../service/order.service";
import { FulfillmentBadge, StatusBadge } from "./order-badges";

// dueAt 재계산 금지 — 서버 계산 ISO 표시만.
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return dayjsAU(iso).format("ddd, D MMM YYYY HH:mm");
}

export default function OrderViewerSummary({
  detail,
}: {
  detail: OrderDetail;
}) {
  return (
    <div className="p-4 border-b border-gray-300">
      <div className="flex items-center gap-3">
        <span className="font-mono text-lg font-bold">{detail.orderNo}</span>
        <StatusBadge status={detail.status} />
        <FulfillmentBadge fulfillment={detail.fulfillment} />
      </div>
      <div className="mt-2 space-y-1 text-base">
        <div className="flex justify-between">
          <span className="text-gray-500">Due</span>
          <span>{fmtDateTime(detail.dueAt)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Member</span>
          <span>
            {detail.memberName}{" "}
            <span className="text-gray-400">(…{detail.memberPhoneLast3})</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Placed</span>
          <span>{fmtDateTime(detail.placedAt)}</span>
        </div>
      </div>
    </div>
  );
}

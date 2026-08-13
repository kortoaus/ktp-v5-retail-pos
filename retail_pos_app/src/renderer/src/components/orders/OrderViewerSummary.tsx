// OrderViewer 섹션 ① 요약 — 주문번호·상태·수령방식·기한(dueAt)·멤버·placedAt.
// 기능 우선(스펙 UI 원칙): 단순 라벨/값 행, 장식 없음.
//
// 전화 리빌: 활성 상태(PLACED/ACCEPTED/READY)에서만 버튼 노출(주문 조정
// 통화가 필요한 시점 — 종결 주문엔 불필요한 PII 접근을 열지 않는다).
// 공개된 번호는 부모(OrderViewer) 로컬 state 에만 존재하고 모든 공개는
// crm MemberRevealLog 에 감사 기록된다.

import dayjsAU from "../../libs/dayjsAU";
import type { OrderDetail } from "../../service/order.service";
import { FulfillmentBadge, StatusBadge } from "./order-badges";

const PHONE_REVEAL_STATUSES = ["PLACED", "ACCEPTED", "READY"] as const;

// dueAt 재계산 금지 — 서버 계산 ISO 표시만.
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return dayjsAU(iso).format("ddd, D MMM YYYY HH:mm");
}

export default function OrderViewerSummary({
  detail,
  revealedPhone,
  revealing,
  onRevealPhone,
  onHidePhone,
}: {
  detail: OrderDetail;
  revealedPhone: string | null;
  revealing: boolean;
  onRevealPhone: () => void;
  onHidePhone: () => void;
}) {
  const canReveal = PHONE_REVEAL_STATUSES.some(
    (status) => status === detail.status,
  );

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
        <div className="flex justify-between items-center">
          <span className="text-gray-500">Member</span>
          <span className="flex items-center gap-2">
            {detail.memberName}{" "}
            {revealedPhone ? (
              <>
                <span className="font-mono font-bold">{revealedPhone}</span>
                <button
                  type="button"
                  onPointerDown={onHidePhone}
                  className="h-10 px-3 rounded-lg border border-gray-300 text-sm font-semibold active:bg-gray-100"
                >
                  Hide
                </button>
              </>
            ) : (
              <>
                <span className="text-gray-400">
                  (…{detail.memberPhoneLast3})
                </span>
                {canReveal ? (
                  <button
                    type="button"
                    onPointerDown={onRevealPhone}
                    disabled={revealing}
                    className="h-10 px-3 rounded-lg border border-gray-300 text-sm font-semibold active:bg-gray-100 disabled:opacity-40"
                  >
                    {revealing ? "..." : "Reveal phone"}
                  </button>
                ) : null}
              </>
            )}
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

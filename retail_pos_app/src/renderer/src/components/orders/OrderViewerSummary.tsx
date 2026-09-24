// OrderViewer 섹션 ① 요약 — 주문번호·상태·수령방식·기한·멤버·placedAt·결제.
// 기능 우선(스펙 UI 원칙): 단순 라벨/값 행, 장식 없음.
// 2026-09-24 트리아지 스펙 §6.4 (§AB-1): DELIVERY 는 "Due … 00:00" 대신 Deliver to(주소
// 3줄)·Delivery note·Delivery day(날짜 · 시간창). 결제 이슈 문구는 뷰어 상단 경고줄
// (triage.issueText)이 정본 — 구 crm(triage 없음)일 때만 클라 결제 배지로 폴백.
// OPEN 환불 요청 = 정보 배지 "Refund requested"(이슈 아님).
//
// 전화 리빌: 활성 상태(PLACED/ACCEPTED/READY)에서만 버튼 노출(주문 조정
// 통화가 필요한 시점 — 종결 주문엔 불필요한 PII 접근을 열지 않는다).
// 공개된 번호는 부모(OrderViewer) 로컬 state 에만 존재하고 모든 공개는
// crm MemberRevealLog 에 감사 기록된다.

import dayjsAU from "../../libs/dayjsAU";
import type { OrderDetail } from "../../service/order.service";
import {
  FulfillmentBadge,
  PaymentAlertBadge,
  StatusBadge,
} from "./order-badges";
import {
  getOrderPaymentAlerts,
  formatOrderPaymentMethod,
  getOrderPaymentStateLabel,
} from "./order-payment-alerts";
import { formatDeliveryDay, hasOpenRefundRequest } from "./triage-format";
import { formatAddressLines } from "./pick-list-render";
import { RefundRequestedBadge } from "./TriageOrderRow";

// 활성 상태 — DELIVERY 진행 상태(SCHEDULED/DISPATCHED)는 배송 조정 통화가
// 필요할 수 있어 포함 (2026-09-24).
const PHONE_REVEAL_STATUSES = [
  "PLACED",
  "ACCEPTED",
  "READY",
  "SCHEDULED",
  "DISPATCHED",
] as const;

// dueAt 재계산 금지 — 서버 계산 ISO 표시만.
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return dayjsAU(iso).format("ddd, D MMM YYYY HH:mm");
}

export default function OrderViewerSummary({
  detail,
  deliveryWindow,
  revealedPhone,
  revealing,
  onRevealPhone,
  onHidePhone,
}: {
  detail: OrderDetail;
  deliveryWindow: { startMinutes: number | null; endMinutes: number | null } | null;
  revealedPhone: string | null;
  revealing: boolean;
  onRevealPhone: () => void;
  onHidePhone: () => void;
}) {
  const canReveal = PHONE_REVEAL_STATUSES.some(
    (status) => status === detail.status,
  );
  // triage 가 있으면 결제 이슈는 상단 경고줄(issueText)이 보여 준다 — 중복 배지 없음.
  const paymentAlerts = detail.triage ? [] : getOrderPaymentAlerts(detail, Date.now());
  const isDelivery = detail.fulfillment === "DELIVERY";
  const addressLines = isDelivery ? formatAddressLines(detail) : [];
  const deliveryNote = detail.shippingNote?.trim() ?? "";

  return (
    <div className="p-4 border-b border-gray-300">
      <div className="flex items-center gap-3">
        <span className="font-mono text-lg font-bold">{detail.orderNo}</span>
        <StatusBadge status={detail.status} />
        <FulfillmentBadge fulfillment={detail.fulfillment} />
        {paymentAlerts.map((alert) => (
          <PaymentAlertBadge key={alert.key} alert={alert} />
        ))}
        {hasOpenRefundRequest(detail.payment) && <RefundRequestedBadge />}
      </div>
      <div className="mt-2 space-y-1 text-base">
        {isDelivery ? (
          <>
            <div className="flex justify-between gap-6">
              <span className="text-gray-500 shrink-0">Deliver to</span>
              <span className="text-right">
                {addressLines.length > 0
                  ? addressLines.map((line) => <div key={line}>{line}</div>)
                  : "—"}
              </span>
            </div>
            {deliveryNote && (
              <div className="flex justify-between gap-6">
                <span className="text-gray-500 shrink-0">Delivery note</span>
                <span className="text-right font-semibold">{deliveryNote}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Delivery day</span>
              <span className="font-semibold">
                {formatDeliveryDay(detail.deliveryEtaDate, deliveryWindow)}
              </span>
            </div>
          </>
        ) : (
          <div className="flex justify-between">
            <span className="text-gray-500">Due</span>
            <span>{fmtDateTime(detail.dueAt)}</span>
          </div>
        )}
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
        {/* STRIPE(온라인 선결제) — 결제 상태는 payment.state 가 정본
            (레거시 paymentStatus 는 로드 차단용 투영). POS 결제 대상 아님. */}
        <div className="flex justify-between">
          <span className="text-gray-500">Payment</span>
          <span>
            {detail.paymentMethod === "STRIPE"
              ? `Card (online) · ${getOrderPaymentStateLabel(detail.payment.state)}`
              : "In store"}
          </span>
        </div>
        {detail.paymentMethod === "STRIPE" &&
          formatOrderPaymentMethod(detail.payment.method) && (
            <div className="flex justify-between">
              <span className="text-gray-500">Card</span>
              <span>{formatOrderPaymentMethod(detail.payment.method)}</span>
            </div>
          )}
      </div>
    </div>
  );
}

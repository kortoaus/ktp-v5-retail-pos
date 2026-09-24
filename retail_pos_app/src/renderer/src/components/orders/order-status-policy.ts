// 주문 상태 전이 정책 — 버튼 노출용 클라 복사본 (슬라이스 B).
// 정본은 crm-server(409 최종 방어선), 서버측 복사본은
// retail_pos_server/src/v1/order/order.status-policy.ts. 공유 금지
// (두 패키지 빌드 독립 — v1 픽업 관례, 스펙 2026-08-13). 동기 수정할 것.
//
// 2026-09-24 Uncles 딜리버리+Stripe (crm 스펙 §3.2): 전이 map 을 fulfillment
// 별로 분리. DELIVERY 는 READY 를 쓰지 않고 ACCEPTED → SCHEDULED(캡처) →
// DISPATCHED → DELIVERED. fulfillment 인자를 생략하면 C&C (기존 호출 호환).
// POS 는 단건 전이만 노출 — 일괄 Schedule/Dispatch 는 러너 전담(스펙 §9).

import type {
  OrderFulfillment,
  OrderStatus,
} from "../../service/order.service";

// POS 가 만들 수 있는 목적 상태 (COLLECTED 는 슬라이스 E, CANCELLED 는
// 소비자 전용, EXPIRED/ABANDONED 는 시스템 전용 — 전이 버튼 대상이 아니다).
export type OrderStatusAction =
  | "ACCEPTED"
  | "READY"
  | "SCHEDULED"
  | "DISPATCHED"
  | "DELIVERED"
  | "REJECTED";

type TransitionMap = Record<OrderStatus, readonly OrderStatusAction[]>;

const NONE: readonly OrderStatusAction[] = [];

const clickAndCollectTransitions: TransitionMap = {
  PENDING_PAYMENT: NONE,
  PLACED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["READY", "REJECTED"],
  READY: ["REJECTED"],
  SCHEDULED: NONE,
  DISPATCHED: NONE,
  DELIVERED: NONE,
  COLLECTED: NONE,
  CANCELLED: NONE,
  REJECTED: NONE,
  EXPIRED: NONE,
  ABANDONED: NONE,
};

const deliveryTransitions: TransitionMap = {
  PENDING_PAYMENT: NONE,
  PLACED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["SCHEDULED", "REJECTED"],
  SCHEDULED: ["DISPATCHED", "REJECTED"],
  DISPATCHED: ["DELIVERED", "REJECTED"],
  READY: NONE, // DELIVERY 는 READY 를 쓰지 않는다 (crm 409 NOT_FOR_DELIVERY)
  DELIVERED: NONE,
  COLLECTED: NONE,
  CANCELLED: NONE,
  REJECTED: NONE,
  EXPIRED: NONE,
  ABANDONED: NONE,
};

function transitionsFor(fulfillment: OrderFulfillment): TransitionMap {
  return fulfillment === "DELIVERY"
    ? deliveryTransitions
    : clickAndCollectTransitions;
}

export function canTransitionOrderStatus(
  fromStatus: OrderStatus,
  toStatus: OrderStatusAction,
  fulfillment: OrderFulfillment = "CLICK_AND_COLLECT",
): boolean {
  return transitionsFor(fulfillment)[fromStatus].includes(toStatus);
}

// admin 스코프 요구 reject: READY 발(v1 manager 게이트 계승) + DELIVERY 캡처 이후
// (SCHEDULED·DISPATCHED — 이미 카드 청구됨, 거절 = 환불 필수). 후자는 오너 결정
// 2026-09-24 로 스펙 §6.4(경고만)를 강화 — 직원 실수 한 번이 손님 돈 문제가 되므로.
export function requiresAdminForOrderStatusTransition(
  fromStatus: OrderStatus,
  toStatus: OrderStatusAction,
): boolean {
  return (
    toStatus === "REJECTED" &&
    (fromStatus === "READY" ||
      fromStatus === "SCHEDULED" ||
      fromStatus === "DISPATCHED")
  );
}

// 버튼 노출 규칙: 전이 유효 + (admin 필요 시 admin 보유)만 노출 —
// 비활성 버튼이 아니라 미표시 (스펙 UI 원칙).
export function getVisibleOrderStatusActions(
  fromStatus: OrderStatus,
  userScopes: readonly string[],
  fulfillment: OrderFulfillment = "CLICK_AND_COLLECT",
): OrderStatusAction[] {
  return transitionsFor(fulfillment)[fromStatus].filter(
    (toStatus) =>
      !requiresAdminForOrderStatusTransition(fromStatus, toStatus) ||
      userScopes.includes("admin"),
  );
}

// 주문 상태 전이 정책 (슬라이스 B) — crm-server 가 정본(409 최종 방어선),
// 이 복사본은 버튼 노출/로컬 게이트용. v1 픽업 status-policy 부활판.
// 앱(components/orders/order-status-policy.ts)에 같은 map 이 1부 더 있다 —
// 공유 금지(두 패키지 빌드 독립, 스펙 2026-08-13 지시). 동기 수정할 것.
//
// 2026-09-24 Uncles 딜리버리+Stripe (crm 스펙 §3.2): 전이 map 을 fulfillment
// 별로 분리. DELIVERY 는 READY 를 쓰지 않고 ACCEPTED → SCHEDULED(캡처) →
// DISPATCHED → DELIVERED. fulfillment 인자를 생략하면 C&C (기존 호출 호환).

import {
  BadRequestException,
  UnauthorizedException,
} from "../../libs/exceptions";
import type { OrderFulfillmentWire, OrderStatusWire } from "./order.types";

// POS 가 만들 수 있는 목적 상태 (COLLECTED 는 슬라이스 E, CANCELLED 는
// 소비자 전용, EXPIRED/ABANDONED 는 시스템 전용 — 전이 버튼 대상이 아니다).
export type OrderStatusAction =
  | "ACCEPTED"
  | "READY"
  | "SCHEDULED"
  | "DISPATCHED"
  | "DELIVERED"
  | "REJECTED";

type TransitionMap = Record<OrderStatusWire, readonly OrderStatusAction[]>;

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

function transitionsFor(fulfillment: OrderFulfillmentWire): TransitionMap {
  return fulfillment === "DELIVERY"
    ? deliveryTransitions
    : clickAndCollectTransitions;
}

export function canTransitionOrderStatus(
  fromStatus: OrderStatusWire,
  toStatus: OrderStatusAction,
  fulfillment: OrderFulfillmentWire = "CLICK_AND_COLLECT",
): boolean {
  return transitionsFor(fulfillment)[fromStatus].includes(toStatus);
}

// READY 발 reject 만 admin 스코프 요구 (v1 manager 게이트 계승). DELIVERY
// 캡처 이후(SCHEDULED·DISPATCHED) reject 는 스펙(§6.4)상 게이트 없이 경고
// 문구("already charged — refund in Stripe Dashboard")만 — 앱 확인 모달 몫.
export function requiresAdminForOrderStatusTransition(
  fromStatus: OrderStatusWire,
  toStatus: OrderStatusAction,
): boolean {
  return fromStatus === "READY" && toStatus === "REJECTED";
}

// 버튼 노출 규칙: 전이 유효 + (admin 필요 시 admin 보유)만 노출 —
// 비활성 버튼이 아니라 미표시 (스펙 UI 원칙).
export function getVisibleOrderStatusActions(
  fromStatus: OrderStatusWire,
  userScopes: readonly string[],
  fulfillment: OrderFulfillmentWire = "CLICK_AND_COLLECT",
): OrderStatusAction[] {
  return transitionsFor(fulfillment)[fromStatus].filter(
    (toStatus) =>
      !requiresAdminForOrderStatusTransition(fromStatus, toStatus) ||
      userScopes.includes("admin"),
  );
}

export function assertOrderStatusTransitionAllowed(
  fromStatus: OrderStatusWire,
  toStatus: OrderStatusAction,
  fulfillment: OrderFulfillmentWire = "CLICK_AND_COLLECT",
): void {
  if (canTransitionOrderStatus(fromStatus, toStatus, fulfillment)) return;
  throw new BadRequestException(
    `Cannot change order from ${fromStatus} to ${toStatus}`,
  );
}

export function assertOrderStatusAdminAllowed(
  fromStatus: OrderStatusWire,
  toStatus: OrderStatusAction,
  userScopes: readonly string[],
): void {
  if (!requiresAdminForOrderStatusTransition(fromStatus, toStatus)) return;
  if (userScopes.includes("admin")) return;
  throw new UnauthorizedException("Admin permission required");
}

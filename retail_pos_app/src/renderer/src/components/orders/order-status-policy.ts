// 주문 상태 전이 정책 — 버튼 노출용 클라 복사본 (슬라이스 B).
// 정본은 crm-server(409 최종 방어선), 서버측 복사본은
// retail_pos_server/src/v1/order/order.status-policy.ts. 공유 금지
// (두 패키지 빌드 독립 — v1 픽업 관례, 스펙 2026-08-13). 동기 수정할 것.

import type { OrderStatus } from "../../service/order.service";

// POS 가 만들 수 있는 목적 상태 (COLLECTED 는 슬라이스 E, CANCELLED 는
// 소비자 전용, EXPIRED 는 시스템 전용 — 전이 버튼 대상이 아니다).
export type OrderStatusAction = "ACCEPTED" | "READY" | "REJECTED";

const allowedTransitions: Record<OrderStatus, readonly OrderStatusAction[]> = {
  PLACED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["READY", "REJECTED"],
  READY: ["REJECTED"],
  COLLECTED: [],
  CANCELLED: [],
  REJECTED: [],
  EXPIRED: [],
};

export function canTransitionOrderStatus(
  fromStatus: OrderStatus,
  toStatus: OrderStatusAction,
): boolean {
  return allowedTransitions[fromStatus].includes(toStatus);
}

// READY 발 reject 만 admin 스코프 요구 (v1 manager 게이트 계승).
export function requiresAdminForOrderStatusTransition(
  fromStatus: OrderStatus,
  toStatus: OrderStatusAction,
): boolean {
  return fromStatus === "READY" && toStatus === "REJECTED";
}

// 버튼 노출 규칙: 전이 유효 + (admin 필요 시 admin 보유)만 노출 —
// 비활성 버튼이 아니라 미표시 (스펙 UI 원칙).
export function getVisibleOrderStatusActions(
  fromStatus: OrderStatus,
  userScopes: readonly string[],
): OrderStatusAction[] {
  return allowedTransitions[fromStatus].filter(
    (toStatus) =>
      !requiresAdminForOrderStatusTransition(fromStatus, toStatus) ||
      userScopes.includes("admin"),
  );
}

// 주문 상태 전이 정책 (슬라이스 B) — crm-server 가 정본(409 최종 방어선),
// 이 복사본은 버튼 노출/로컬 게이트용. v1 픽업 status-policy 부활판.
// 앱(components/orders/order-status-policy.ts)에 같은 map 이 1부 더 있다 —
// 공유 금지(두 패키지 빌드 독립, 스펙 2026-08-13 지시). 동기 수정할 것.

import {
  BadRequestException,
  UnauthorizedException,
} from "../../libs/exceptions";
import type { OrderStatusWire } from "./order.types";

// POS 가 만들 수 있는 목적 상태 (COLLECTED 는 슬라이스 E, CANCELLED 는
// 소비자 전용, EXPIRED 는 시스템 전용 — 전이 버튼 대상이 아니다).
export type OrderStatusAction = "ACCEPTED" | "READY" | "REJECTED";

const allowedTransitions: Record<
  OrderStatusWire,
  readonly OrderStatusAction[]
> = {
  PLACED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["READY", "REJECTED"],
  READY: ["REJECTED"],
  COLLECTED: [],
  CANCELLED: [],
  REJECTED: [],
  EXPIRED: [],
};

export function canTransitionOrderStatus(
  fromStatus: OrderStatusWire,
  toStatus: OrderStatusAction,
): boolean {
  return allowedTransitions[fromStatus].includes(toStatus);
}

// READY 발 reject 만 admin 스코프 요구 (v1 manager 게이트 계승).
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
): OrderStatusAction[] {
  return allowedTransitions[fromStatus].filter(
    (toStatus) =>
      !requiresAdminForOrderStatusTransition(fromStatus, toStatus) ||
      userScopes.includes("admin"),
  );
}

export function assertOrderStatusTransitionAllowed(
  fromStatus: OrderStatusWire,
  toStatus: OrderStatusAction,
): void {
  if (canTransitionOrderStatus(fromStatus, toStatus)) return;
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

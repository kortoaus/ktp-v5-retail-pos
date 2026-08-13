// 주문 수신함 소켓 상태의 모듈 레벨 공유 스토어.
//
// OrderNotification(Gateway 상주, 단일 소켓 소유자)이 쓰고,
// OrdersPendingButton(SaleScreen 상단 배지)이 useSyncExternalStore 로 읽는다.
// 배지마다 소켓을 하나씩 여는 구 PickupPendingCountButton 패턴 대신
// 소켓 1개 + 공유 상태로 단순화한 것 (스펙 2026-08-10).

export type OrderPendingCountPayload = {
  ok: boolean;
  count: number | null; // null = crm 불통 (ok:false)
  chimeTerminalIds: number[];
  generatedAt: string;
};

export type OrderInboxState = {
  connected: boolean;
  payload: OrderPendingCountPayload | null;
};

export const ORDER_PENDING_COUNT_EVENT = "order:pending-count";
export const ORDER_NEW_EVENT = "order:new";

let state: OrderInboxState = { connected: false, payload: null };
const listeners = new Set<() => void>();

export function setOrderInboxState(partial: Partial<OrderInboxState>): void {
  state = { ...state, ...partial };
  listeners.forEach((listener) => listener());
}

export function subscribeOrderInbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOrderInboxState(): OrderInboxState {
  return state;
}

// 슬라이스 B: PLACED 발 전이 성공 시 낙관적 -1 (0 클램프).
// 브로드캐스터 다음 틱 payload 가 정본으로 덮어쓴다 — 차임 갭 제거 전용.
export function decrementPendingCount(): void {
  if (!state.payload || state.payload.count == null) return;
  setOrderInboxState({
    payload: {
      ...state.payload,
      count: Math.max(0, state.payload.count - 1),
    },
  });
}

export function normalizeOrderPendingCountPayload(
  next: unknown,
): OrderPendingCountPayload | null {
  if (!next || typeof next !== "object") return null;
  const maybe = next as Partial<OrderPendingCountPayload>;
  if (maybe.count != null && !Number.isFinite(maybe.count)) return null;
  if (!Array.isArray(maybe.chimeTerminalIds)) return null;
  return {
    ok: maybe.ok === true,
    count: maybe.count ?? null,
    chimeTerminalIds: maybe.chimeTerminalIds.filter(
      (id): id is number => typeof id === "number" && Number.isFinite(id),
    ),
    generatedAt:
      typeof maybe.generatedAt === "string"
        ? maybe.generatedAt
        : new Date().toISOString(),
  };
}

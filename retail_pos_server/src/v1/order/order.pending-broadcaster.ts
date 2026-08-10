// 주문 수신함 pending-count 브로드캐스터 (슬라이스 A).
//
// 60초마다 crm `/device/order/pending-count`(회사 PLACED 건수)를 폴링해
// 전 소켓에 `order:pending-count` 를 브로드캐스트한다. 직전 성공 틱보다
// 카운트가 **증가**하면 `order:new` 를 추가 발사한다 (앱 즉시 차임 트리거).
//
// - 차임 게이트: 로컬 Terminal.orderChimeEnabled=true 인 id 목록을 페이로드에
//   실어 보내고, 각 앱이 자기 터미널 id 로 판단한다 (재시동 불요).
// - crm 불통: `{ ok: false, count: null, ... }` 브로드캐스트 + console.error 만.
//   재시도는 다음 틱 (fire-and-forget).
// - 픽업 1차 브로드캐스터의 CRON_INSTANCE env 게이트는 의도적으로 없음 —
//   src/index.ts 에서 무조건 시작한다 (스펙 2026-08-10).

import type { Socket } from "socket.io";
import db from "../../libs/db";
import { getIO } from "../../libs/socket";
import { crmApiService } from "../../libs/cloud.api";

export const ORDER_PENDING_COUNT_EVENT = "order:pending-count";
export const ORDER_NEW_EVENT = "order:new";
export const ORDER_PENDING_COUNT_INTERVAL_MS = 60_000;

export type OrderPendingCountPayload = {
  ok: boolean;
  count: number | null;
  chimeTerminalIds: number[];
  generatedAt: string;
};

export type OrderPendingTickOutcome = {
  payload: OrderPendingCountPayload;
  emitOrderNew: boolean;
  nextSuccessfulCount: number | null;
};

// ── 순수 로직 (colocated *.test.ts 대상) ─────────────────────────

export function buildOrderPendingCountPayload(
  count: number | null,
  chimeTerminalIds: number[],
  now: Date = new Date(),
): OrderPendingCountPayload {
  return {
    ok: count != null,
    count,
    chimeTerminalIds,
    generatedAt: now.toISOString(),
  };
}

export function shouldEmitOrderNew(
  previousSuccessfulCount: number | null,
  nextCount: number | null,
): boolean {
  return (
    previousSuccessfulCount != null &&
    nextCount != null &&
    nextCount > previousSuccessfulCount
  );
}

export function computeOrderPendingTickOutcome(
  previousSuccessfulCount: number | null,
  count: number | null,
  chimeTerminalIds: number[],
  now: Date = new Date(),
): OrderPendingTickOutcome {
  return {
    payload: buildOrderPendingCountPayload(count, chimeTerminalIds, now),
    emitOrderNew: shouldEmitOrderNew(previousSuccessfulCount, count),
    // 실패 틱(count=null)은 비교 기준을 갱신하지 않는다 — "직전 성공 틱" 대비.
    nextSuccessfulCount: count ?? previousSuccessfulCount,
  };
}

// ── 데이터 소스 ──────────────────────────────────────────────────

async function fetchPendingCountFromCrm(): Promise<number | null> {
  const res = await crmApiService.get<{ count: number }>(
    "/device/order/pending-count",
  );
  if (!res.ok || res.result == null || !Number.isFinite(res.result.count)) {
    console.error(
      "[order.pending-broadcaster] crm pending-count failed:",
      res.status,
      res.msg,
    );
    return null;
  }
  return res.result.count;
}

async function fetchChimeTerminalIds(): Promise<number[]> {
  const terminals = await db.terminal.findMany({
    where: { orderChimeEnabled: true },
    select: { id: true },
  });
  return terminals.map((t) => t.id);
}

// ── 모듈 상태 + 구동 ─────────────────────────────────────────────

let lastPayload: OrderPendingCountPayload | null = null;
let lastSuccessfulCount: number | null = null;
let tickRunning = false;
let intervalHandle: NodeJS.Timeout | null = null;

type OrderPendingTickDeps = {
  fetchPendingCount?: () => Promise<number | null>;
  fetchChimeTerminalIds?: () => Promise<number[]>;
  now?: () => Date;
};

export async function runOrderPendingTick(
  deps: OrderPendingTickDeps = {},
): Promise<void> {
  try {
    const count = await (deps.fetchPendingCount ?? fetchPendingCountFromCrm)();
    const chimeTerminalIds = await (
      deps.fetchChimeTerminalIds ?? fetchChimeTerminalIds
    )();
    const outcome = computeOrderPendingTickOutcome(
      lastSuccessfulCount,
      count,
      chimeTerminalIds,
      deps.now?.() ?? new Date(),
    );

    lastPayload = outcome.payload;
    lastSuccessfulCount = outcome.nextSuccessfulCount;

    const io = getIO();
    io.emit(ORDER_PENDING_COUNT_EVENT, outcome.payload);
    if (outcome.emitOrderNew) {
      io.emit(ORDER_NEW_EVENT, { count: outcome.payload.count });
    }
  } catch (error) {
    // 로컬 DB 조회 실패 등 — 이번 틱만 건너뛴다.
    console.error("[order.pending-broadcaster] tick failed:", error);
  }
}

// 신규 소켓 접속 시 마지막 페이로드를 즉시 1회 전송 (다음 틱까지 공백 방지).
export function emitLastOrderPendingPayloadToSocket(socket: Socket): void {
  if (lastPayload) {
    socket.emit(ORDER_PENDING_COUNT_EVENT, lastPayload);
  }
}

export function startOrderPendingBroadcaster(): void {
  if (intervalHandle) return;

  const run = () => {
    if (tickRunning) return; // 재진입 가드
    tickRunning = true;
    runOrderPendingTick().finally(() => {
      tickRunning = false;
    });
  };

  run();
  intervalHandle = setInterval(run, ORDER_PENDING_COUNT_INTERVAL_MS);
}

export function stopOrderPendingBroadcasterForTest(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  tickRunning = false;
  lastPayload = null;
  lastSuccessfulCount = null;
}

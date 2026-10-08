// 주문 수신함 pending-count 브로드캐스터 (슬라이스 A) + 트리아지 buckets (2026-09-24).
//
// 30초마다(트리아지 스펙 §5-3, 기존 60초) crm `/device/order/buckets` 를 1회 호출해
// 전 소켓에 `order:buckets`(buckets result + chimeTerminalIds)를 브로드캐스트하고,
// 배포된 POS/러너를 위해 `order:pending-count`(count = counts.new.total)도 계속
// 발사한다. crm 이 구버전(buckets 404)이면 `/device/order/pending-count` 로 폴백하고
// `order:buckets` 는 보내지 않는다(새 앱은 90초 무수신 시 자체 폴링으로 폴백).
// 직전 성공 틱보다 카운트가 **증가**하면 `order:new` 를 추가 발사한다 (앱 즉시 차임).
//
// - 차임 게이트: 로컬 Terminal.orderChimeEnabled=true 인 id 목록을 페이로드에
//   실어 보내고, 각 앱이 자기 터미널 id 로 판단한다 (재시동 불요).
// - crm 불통: `{ ok: false, count: null, ... }` 브로드캐스트 + console.error 만.
//   재시도는 다음 틱 (fire-and-forget).
// - 픽업 1차 브로드캐스터의 CRON_INSTANCE env 게이트는 의도적으로 없음 —
//   src/index.ts 에서 무조건 시작한다 (스펙 2026-08-10).

import { createHash } from "node:crypto";
import type { Socket } from "socket.io";
import db from "../../libs/db";
import { getIO } from "../../libs/socket";
import { crmApiService } from "../../libs/cloud.api";
import type { OrderBucketsWire } from "./order.types";

export const ORDER_PENDING_COUNT_EVENT = "order:pending-count";
export const ORDER_NEW_EVENT = "order:new";
export const ORDER_BUCKETS_EVENT = "order:buckets";
// 틱 주기 상수 1곳 (트리아지 스펙 §5-3: 60s → 30s).
export const ORDER_PENDING_COUNT_INTERVAL_MS = 30_000;

export type OrderBucketsPayload = {
  ok: boolean;
  result: OrderBucketsWire | null; // null = crm 불통
  chimeTerminalIds: number[];
  generatedAt: string;
  // T-24 (R-15) — changes only when the bucket content changes (counts, the
  // Sydney day, delivery date/window) or this server proxied an order write;
  // never just because a tick happened (`asOf` is excluded). null = crm 불통.
  // Tills refetch their triage list only when it changes.
  revision: string | null;
};

// buckets 호출 결과 — unsupported = crm 구버전(404) → pending-count 폴백.
export type OrderBucketsFetch =
  | { kind: "ok"; buckets: OrderBucketsWire }
  | { kind: "unsupported" }
  | { kind: "failed" };

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

// Canonical JSON (sorted keys) so the revision does not depend on key order.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

// T-24 (R-15). The crm buckets wire carries counts, not order ids/statuses, so
// the revision is the bucket content minus the clock (`asOf`) plus a counter of
// order writes this server proxied (accept/ready/reject/… from any till) — a
// write that leaves the counts unchanged still moves the revision.
export function computeBucketsRevision(
  buckets: OrderBucketsWire | null,
  localOrderWriteSeq: number,
): string | null {
  if (!buckets) return null;
  const { asOf: _asOf, ...content } = buckets;
  return createHash("sha1")
    .update(`${canonicalJson(content)}|${localOrderWriteSeq}`)
    .digest("hex")
    .slice(0, 16);
}

let localOrderWriteSeq = 0;

// Called after a successful order write proxied by this server.
export function noteLocalOrderWrite(): void {
  localOrderWriteSeq++;
}

export function buildOrderBucketsPayload(
  buckets: OrderBucketsWire | null,
  chimeTerminalIds: number[],
  now: Date = new Date(),
  revision: string | null = computeBucketsRevision(buckets, localOrderWriteSeq),
): OrderBucketsPayload {
  return {
    ok: buckets != null,
    result: buckets,
    chimeTerminalIds,
    generatedAt: now.toISOString(),
    revision,
  };
}

// buckets 결과 → pending-count 값. ok 면 counts.new.total (= PLACED 전체, 스펙 §4.1).
export function pendingCountFromBuckets(buckets: OrderBucketsWire): number | null {
  const total = buckets?.counts?.new?.total;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

// ── 데이터 소스 ──────────────────────────────────────────────────

export function classifyBucketsResponse(res: {
  ok: boolean;
  status?: number;
  result?: OrderBucketsWire | null;
}): OrderBucketsFetch {
  if (res.ok && res.result && pendingCountFromBuckets(res.result) != null) {
    return { kind: "ok", buckets: res.result };
  }
  if (res.status === 404) return { kind: "unsupported" };
  return { kind: "failed" };
}

async function fetchBucketsFromCrm(): Promise<OrderBucketsFetch> {
  const res = await crmApiService.get<OrderBucketsWire>("/device/order/buckets");
  const outcome = classifyBucketsResponse(res);
  if (outcome.kind === "failed") {
    console.error(
      "[order.pending-broadcaster] crm buckets failed:",
      res.status,
      res.msg,
    );
  }
  return outcome;
}

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
let lastBucketsPayload: OrderBucketsPayload | null = null;
let lastSuccessfulCount: number | null = null;
let tickRunning = false;
let intervalHandle: NodeJS.Timeout | null = null;

type OrderPendingTickDeps = {
  fetchBuckets?: () => Promise<OrderBucketsFetch>;
  fetchPendingCount?: () => Promise<number | null>;
  fetchChimeTerminalIds?: () => Promise<number[]>;
  now?: () => Date;
};

export async function runOrderPendingTick(
  deps: OrderPendingTickDeps = {},
): Promise<void> {
  try {
    const fetched = await (deps.fetchBuckets ?? fetchBucketsFromCrm)();
    const count =
      fetched.kind === "ok"
        ? pendingCountFromBuckets(fetched.buckets)
        : fetched.kind === "unsupported"
          ? await (deps.fetchPendingCount ?? fetchPendingCountFromCrm)()
          : null;
    const chimeTerminalIds = await (
      deps.fetchChimeTerminalIds ?? fetchChimeTerminalIds
    )();
    const now = deps.now?.() ?? new Date();
    const outcome = computeOrderPendingTickOutcome(
      lastSuccessfulCount,
      count,
      chimeTerminalIds,
      now,
    );

    lastPayload = outcome.payload;
    lastSuccessfulCount = outcome.nextSuccessfulCount;

    const io = getIO();
    // 구 crm(unsupported) 에는 order:buckets 를 보내지 않는다 — 새 앱이 무수신으로 폴백.
    if (fetched.kind !== "unsupported") {
      lastBucketsPayload = buildOrderBucketsPayload(
        fetched.kind === "ok" ? fetched.buckets : null,
        chimeTerminalIds,
        now,
      );
      io.emit(ORDER_BUCKETS_EVENT, lastBucketsPayload);
    }
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
  if (lastBucketsPayload) {
    socket.emit(ORDER_BUCKETS_EVENT, lastBucketsPayload);
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
  lastBucketsPayload = null;
  lastSuccessfulCount = null;
  localOrderWriteSeq = 0;
}

import db from "../../libs/db";
import { crmApiService, type ApiResponse } from "../../libs/cloud.api";
import type { Prisma } from "../../generated/prisma/client";
import {
  createSweepRunner,
  type SweepPageResult,
  type SweepPendingStats,
  type SweepRunnerOptions,
  type SweepSource,
} from "../cloud/sweep-runner";

// ══════════════════════════════════════════════════════════════
// S3 — 결제 → COLLECTED 전이 (specs/2026-08-21-pos-order-load-collect-design.md)
//
// SaleInvoice.externalOrderId 가 있는 SALE 이 결제 완료되면 crm
// `POST /device/order/:id/collect` 로 주문을 닫는다. **best-effort** —
// 실패해도 판매는 성립하고, `externalOrderCollectSyncedAt IS NULL` 인
// 인보이스를 기존 업싱크 트리거(판매 생성·클라우드 마이그레이트·서버
// 부팅·시프트 마감)에서 스윕한다. crm 이 멱등(동일 posInvoiceSerial 재호출
// = 200)이라 직접 호출과 스윕이 겹쳐도 안전하다.
//
// 영구 409 (TRANSITION_CONFLICT — 주문이 REJECTED 등으로 닫힘) 는
// syncedAt=now + console.warn 으로 종료해 무한 재시도를 막는다 (사람 처리).
// T-24 (R-5/R-8/R-18): 스윕은 sweep-runner 로 — 페이지(50) 단위, 실행 중
// 트리거는 재실행 1회로 합치고, retry 로 끝나면 1→2→5→10분 백오프 재시도.
// ══════════════════════════════════════════════════════════════

// crm 계약 body — {posInvoiceSerial} 뿐 (version 없음: 결제 성립이 권위).
export function buildCollectBody(posInvoiceSerial: string): {
  posInvoiceSerial: string;
} {
  return { posInvoiceSerial };
}

// 결과 분류 (순수 — 스윕 판정 로직, T-24 R-8):
//   synced    — crm 이 전이(또는 멱등 재확인) 성공. syncedAt 기록.
//   conflict  — 409 TRANSITION_CONFLICT 만 (주문이 REJECTED 등으로 이미 닫힘).
//               syncedAt 기록 + warn (사람 처리).
//   permanent — 그 외 4xx (400 잘못된 요청, 404 주문 부재, 422 …) — 재시도해도
//               같은 응답이라 syncedAt 기록 + warn (사람 처리). 동작은 conflict
//               와 같고 로그/집계만 구분.
//   retry     — 일시 실패: 타임아웃(axios)·네트워크·5xx·408·429, 그리고
//               401/403(인증 미스컨피그 — 키를 고치면 회복). syncedAt 을 절대
//               기록하지 않는다 — 스윕이 백오프로 다시 시도.
export type CollectOutcome = "synced" | "conflict" | "permanent" | "retry";

const RETRYABLE_4XX = new Set([401, 403, 408, 429]);

export function classifyCollectResult(res: {
  ok: boolean;
  status?: number;
  transport?: "timeout" | "network";
}): CollectOutcome {
  if (res.ok) return "synced";
  if (res.transport) return "retry"; // no HTTP answer: timeout / network
  const status = res.status;
  if (status === 409) return "conflict";
  if (status != null && RETRYABLE_4XX.has(status)) return "retry";
  if (status != null && status >= 400 && status < 500) return "permanent";
  return "retry";
}

export interface CollectableInvoice {
  id: number;
  serial: string | null;
  externalOrderId: string | null;
}

export interface CollectCallDeps {
  post(path: string, body: { posInvoiceSerial: string }): Promise<ApiResponse>;
  stampSynced(invoiceId: number): Promise<void>;
}

export const defaultCollectCallDeps: CollectCallDeps = {
  post: (path, body) => crmApiService.post(path, body),
  stampSynced: async (invoiceId) => {
    await db.saleInvoice.update({
      where: { id: invoiceId },
      data: { externalOrderCollectSyncedAt: new Date() },
    });
  },
};

// 단건 collect 호출 + DB 기록. outcome 을 반환한다. retry 는 stamp 하지 않는다.
export async function collectInvoiceOrder(
  inv: CollectableInvoice,
  deps: CollectCallDeps = defaultCollectCallDeps,
): Promise<CollectOutcome> {
  if (!inv.externalOrderId || !inv.serial) return "retry";

  const res = await deps.post(
    `/device/order/${encodeURIComponent(inv.externalOrderId)}/collect`,
    buildCollectBody(inv.serial),
  );

  const outcome = classifyCollectResult(res);
  if (outcome === "retry") {
    console.error(
      `[order.collect] invoice ${inv.id} (order ${inv.externalOrderId}) collect failed: ${res.msg}`,
    );
    return outcome;
  }

  if (outcome === "conflict" || outcome === "permanent") {
    // 영구 실패 — 409 는 주문이 이미 닫혀 있음(REJECTED 등), 그 외 4xx 는
    // 재시도 무의미(부재/요청 불량). 판매는 성립 유지, 사람 처리 (스펙 §4).
    console.warn(
      `[order.collect] invoice ${inv.id} (order ${inv.externalOrderId}) ${outcome} ${res.status} (${res.msg ?? "no msg"}) — marking synced, needs human follow-up`,
    );
  }

  await deps.stampSynced(inv.id);
  return outcome;
}

// 스윕 — externalOrderId 있고 collect 미확인인 인보이스를 id 순 페이지로 시도.
// retry 를 만나면 이번 실행을 멈춘다(halt) — 클라우드가 죽어 있을 때 연속
// 타임아웃(30s)으로 매달리지 않기 위함; 러너가 백오프 재시도를 예약한다
// (인보이스 간 의존성은 없음: 멱등이라 순서 무관).
const pendingCollectWhere = {
  externalOrderId: { not: null },
  externalOrderCollectSyncedAt: null,
  serial: { not: null },
} satisfies Prisma.SaleInvoiceWhereInput;

export interface CollectSweepDeps {
  loadPage(afterId: number, limit: number): Promise<CollectableInvoice[]>;
  collect(inv: CollectableInvoice): Promise<CollectOutcome>;
  pendingStats(): Promise<SweepPendingStats>;
}

export const prismaCollectSweepDeps: CollectSweepDeps = {
  loadPage: (afterId, limit) =>
    db.saleInvoice.findMany({
      where: { ...pendingCollectWhere, id: { gt: afterId } },
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true, serial: true, externalOrderId: true },
    }),
  collect: (inv) => collectInvoiceOrder(inv),
  pendingStats: async () => {
    const [count, oldest] = await Promise.all([
      db.saleInvoice.count({ where: pendingCollectWhere }),
      db.saleInvoice.findFirst({
        where: pendingCollectWhere,
        orderBy: { id: "asc" },
        select: { createdAt: true },
      }),
    ]);
    return { count, oldestAt: oldest?.createdAt ?? null };
  },
};

export function createCollectSweepSource(
  deps: CollectSweepDeps,
): SweepSource<CollectableInvoice> {
  return {
    name: "collect",
    loadPage: deps.loadPage,
    pendingStats: deps.pendingStats,
    async processPage(rows): Promise<SweepPageResult> {
      const result: SweepPageResult = { done: 0, deferred: 0, failed: 0, halted: false };
      for (const inv of rows) {
        const outcome = await deps.collect(inv);
        if (outcome === "retry") {
          result.failed++;
          result.halted = true;
          return result;
        }
        result.done++; // synced, conflict or permanent — all stamped
      }
      return result;
    },
  };
}

export function createCollectSweepRunner(
  deps: CollectSweepDeps = prismaCollectSweepDeps,
  options?: SweepRunnerOptions,
) {
  return createSweepRunner(createCollectSweepSource(deps), options);
}

const collectSweep = createCollectSweepRunner();

export function triggerSyncPendingOrderCollects() {
  // fire-and-forget — 호출측은 await 하지 않는다 (업싱크 트리거 관례).
  void collectSweep.trigger();
}

// 판매 응답 DTO 의 collectResult 트라이스테이트 (S3 리뷰 반영 — 영구 충돌을
// "자동 재시도 중" 으로 오표시하지 않기 위해 boolean 에서 확장):
//   collected — deadline 안에 crm 전이 확인.
//   pending   — 미확인 (타임아웃/네트워크/5xx) — 스윕이 자동 재시도.
//   conflict  — 영구 실패 (409 및 그 외 4xx = conflict/permanent) — 재시도
//               없음, 사람 확인 필요.
export type CollectSaleResult = "collected" | "pending" | "conflict";

// outcome → 응답 트라이스테이트 매핑 (순수).
export function toCollectSaleResult(
  outcome: CollectOutcome | "timeout",
): CollectSaleResult {
  if (outcome === "synced") return "collected";
  if (outcome === "conflict" || outcome === "permanent") return "conflict";
  return "pending";
}

// 판매 생성 직후의 직접 시도 — 응답 DTO 의 collectResult 용.
// deadline 안에 끝나면 그 outcome 을, 시간 초과 시 "pending" 을 돌려주되,
// 진행 중이던 호출은 그대로 완주해 syncedAt 을 기록한다 (다음 스윕과
// 겹쳐도 crm 멱등이라 안전). 판매 완료 UX 를 클라우드 타임아웃(30s)에
// 볼모잡히지 않게 하는 캡.
export async function collectInvoiceOrderWithDeadline(
  inv: CollectableInvoice,
  deadlineMs = 4000,
): Promise<CollectSaleResult> {
  const attempt = collectInvoiceOrder(inv).catch((e): CollectOutcome => {
    console.error("[order.collect] direct collect threw:", e);
    return "retry";
  });
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), deadlineMs),
  );
  const result = await Promise.race([attempt, timeout]);
  return toCollectSaleResult(result);
}

import db from "../../libs/db";
import { crmApiService } from "../../libs/cloud.api";

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
// ══════════════════════════════════════════════════════════════

let collectSweepRunning = false;

// crm 계약 body — {posInvoiceSerial} 뿐 (version 없음: 결제 성립이 권위).
export function buildCollectBody(posInvoiceSerial: string): {
  posInvoiceSerial: string;
} {
  return { posInvoiceSerial };
}

// 결과 분류 (순수 — 스윕 판정 로직):
//   synced   — crm 이 전이(또는 멱등 재확인) 성공. syncedAt 기록.
//   conflict — 409 TRANSITION_CONFLICT. 영구 실패 — syncedAt 기록 + warn.
//   retry    — 네트워크/5xx/기타. 그대로 두고 다음 스윕이 재시도.
export type CollectOutcome = "synced" | "conflict" | "retry";

export function classifyCollectResult(res: {
  ok: boolean;
  status?: number;
}): CollectOutcome {
  if (res.ok) return "synced";
  if (res.status === 409) return "conflict";
  return "retry";
}

export interface CollectableInvoice {
  id: number;
  serial: string | null;
  externalOrderId: string | null;
}

// 단건 collect 호출 + DB 기록. outcome 을 반환한다.
export async function collectInvoiceOrder(
  inv: CollectableInvoice,
): Promise<CollectOutcome> {
  if (!inv.externalOrderId || !inv.serial) return "retry";

  const res = await crmApiService.post(
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

  if (outcome === "conflict") {
    // 영구 충돌 — 주문이 이미 닫혀 있다(REJECTED 등). 판매는 성립 유지,
    // 운영 충돌은 사람 처리 (스펙 §4).
    console.warn(
      `[order.collect] invoice ${inv.id} (order ${inv.externalOrderId}) permanent 409 TRANSITION_CONFLICT — marking synced, needs human follow-up`,
    );
  }

  await db.saleInvoice.update({
    where: { id: inv.id },
    data: { externalOrderCollectSyncedAt: new Date() },
  });
  return outcome;
}

// 스윕 — externalOrderId 있고 collect 미확인인 인보이스 전부 시도.
// retry(네트워크 계열) 를 만나면 중단 — 클라우드가 죽어 있을 때 연속 타임아웃
// 으로 매달리지 않기 위함 (인보이스 간 의존성은 없음: 멱등이라 순서 무관).
export async function syncPendingOrderCollects(): Promise<{
  synced: number;
  conflicted: number;
  failed: number;
}> {
  if (collectSweepRunning) return { synced: 0, conflicted: 0, failed: 0 };
  collectSweepRunning = true;

  let synced = 0;
  let conflicted = 0;
  let failed = 0;

  try {
    const pending = await db.saleInvoice.findMany({
      where: {
        externalOrderId: { not: null },
        externalOrderCollectSyncedAt: null,
        serial: { not: null },
      },
      orderBy: { id: "asc" },
      select: { id: true, serial: true, externalOrderId: true },
    });

    for (const inv of pending) {
      const outcome = await collectInvoiceOrder(inv);
      if (outcome === "synced") synced++;
      else if (outcome === "conflict") conflicted++;
      else {
        failed++;
        break;
      }
    }
  } finally {
    collectSweepRunning = false;
  }

  return { synced, conflicted, failed };
}

export function triggerSyncPendingOrderCollects() {
  // fire-and-forget — 호출측은 await 하지 않는다 (업싱크 트리거 관례).
  syncPendingOrderCollects().catch((e) => {
    console.error("[order.collect] syncPendingOrderCollects threw:", e);
  });
}

// 판매 생성 직후의 직접 시도 — 응답 DTO 의 collectSynced 플래그용.
// deadline 안에 synced 로 끝나면 true. 시간 초과 시 false 를 돌려주되,
// 진행 중이던 호출은 그대로 완주해 syncedAt 을 기록한다 (다음 스윕과
// 겹쳐도 crm 멱등이라 안전). 판매 완료 UX 를 클라우드 타임아웃(30s)에
// 볼모잡히지 않게 하는 캡.
export async function collectInvoiceOrderWithDeadline(
  inv: CollectableInvoice,
  deadlineMs = 4000,
): Promise<boolean> {
  const attempt = collectInvoiceOrder(inv).catch((e): CollectOutcome => {
    console.error("[order.collect] direct collect threw:", e);
    return "retry";
  });
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), deadlineMs),
  );
  const result = await Promise.race([attempt, timeout]);
  return result === "synced";
}

// order:buckets 무수신 폴백 (트리아지 스펙 §6.3) — 소켓 이벤트가 90초 넘게 안 오면
// (구 pos_server 등) GET /api/order/buckets 를 60초 간격으로 폴링해 같은 스토어에 넣는다.
// 화면이 열린 동안만 동작 (트리아지 화면이 마운트).

import { useEffect } from "react";
import { getOrderBuckets } from "../../service/order.service";
import { applyOrderBuckets, getOrderInboxState } from "./orderInboxStore";

const STALE_MS = 90_000;
const POLL_MS = 60_000;
const CHECK_MS = 15_000;

export async function pollOrderBucketsNow(): Promise<void> {
  const res = await getOrderBuckets();
  applyOrderBuckets(res.ok && res.result ? res.result : null);
}

export function useBucketsFallback(): void {
  useEffect(() => {
    let lastPollAt = 0;
    let stopped = false;
    const check = () => {
      if (stopped) return;
      const now = Date.now();
      const receivedAt = getOrderInboxState().bucketsReceivedAt;
      const stale = receivedAt == null || now - receivedAt > STALE_MS;
      if (stale && now - lastPollAt >= POLL_MS) {
        lastPollAt = now;
        void pollOrderBucketsNow();
      }
    };
    // 진입 직후: 아직 한 번도 못 받았으면 즉시 1회 (소켓은 접속 시 마지막 값을 보내 준다).
    const initial = setTimeout(() => {
      if (getOrderInboxState().bucketsReceivedAt == null) {
        lastPollAt = Date.now();
        void pollOrderBucketsNow();
      }
    }, 1500);
    const handle = setInterval(check, CHECK_MS);
    return () => {
      stopped = true;
      clearTimeout(initial);
      clearInterval(handle);
    };
  }, []);
}

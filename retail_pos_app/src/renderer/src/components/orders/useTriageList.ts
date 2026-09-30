// 트리아지 목록 로더 (2026-09-24 트리아지 스펙 §6.2·§6.3).
//
// - 버킷 목록 = page 1 · limit 100 한 번에 (페이지 병합 없음). keyword 검색도 같은 방식.
// - 화면/칩 전환·수동 ⟳ = 서버 순서로 전체 교체(replace). 소켓 `order:buckets` 틱·자기 액션
//   성공 = 위치 유지 병합(merge — 제자리 갱신, 이탈 행 흐림, 새 행 맨 아래).
// - paused(뷰어 모달 열림·일괄 실행/인쇄 중) 동안의 병합 요청은 보류했다가 풀릴 때 1회.
// - 구 crm 감지: bucket 에코 없음 → serverOutdated (목록 대신 "Server update required").

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getOrders,
  type OrderListPaging,
  type OrderStatus,
  type OrderSummary,
} from "../../service/order.service";
import {
  isBucketEchoMissing,
  listBucketOfView,
  listQueryForView,
  TRIAGE_LIST_LIMIT,
  type TriageView,
} from "./triage-format";
import {
  mergeTriageRows,
  patchTriageRow,
  replaceTriageRows,
  type TriageRowState,
} from "./triage-merge";

export type TriageListSource =
  | { kind: "bucket"; view: TriageView }
  | { kind: "search"; keyword: string };

function sourceKey(source: TriageListSource): string {
  return source.kind === "bucket"
    ? `bucket:${source.view.level1}:${source.view.chip}`
    : `search:${source.keyword}`;
}

function sourceQuery(source: TriageListSource): string {
  if (source.kind === "bucket") return listQueryForView(source.view);
  const params = new URLSearchParams({
    keyword: source.keyword,
    page: "1",
    limit: String(TRIAGE_LIST_LIMIT),
  });
  return `?${params}`;
}

export function useTriageList(
  source: TriageListSource | null,
  refreshSignal: number,
  paused: boolean,
) {
  const [rows, setRows] = useState<TriageRowState<OrderSummary>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [serverOutdated, setServerOutdated] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const knownStatusRef = useRef(new Map<number, OrderStatus>());
  const requestSeqRef = useRef(0);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const pendingMergeRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const load = useCallback(async (mode: "replace" | "merge") => {
    const current = sourceRef.current;
    if (!current) return;
    const seq = ++requestSeqRef.current;
    if (mode === "replace") setLoading(true);
    const res = await getOrders(sourceQuery(current));
    if (seq !== requestSeqRef.current) return; // 더 최신 요청이 있음
    setLoading(false);
    if (!res.ok || !res.result) {
      if (mode === "replace") setRows([]);
      setError(res.msg || "Failed to load orders");
      return;
    }
    const paging = res.paging as OrderListPaging | null;
    if (current.kind === "bucket" && isBucketEchoMissing(paging, listBucketOfView(current.view))) {
      setServerOutdated(true);
      setRows([]);
      setTotal(null);
      setError("");
      return;
    }
    setServerOutdated(false);
    setError("");
    setTotal(typeof paging?.total === "number" ? paging.total : res.result.length);
    setLoadedAt(Date.now());
    setRows(
      mode === "replace"
        ? replaceTriageRows(res.result)
        : mergeTriageRows(rowsRef.current, res.result, knownStatusRef.current),
    );
    if (mode === "replace") knownStatusRef.current = new Map();
  }, []);

  const requestMerge = useCallback(() => {
    if (pausedRef.current) {
      pendingMergeRef.current = true;
      return;
    }
    void load("merge");
  }, [load]);

  // 화면/칩/검색어 전환 → 교체 로드.
  const key = source ? sourceKey(source) : null;
  useEffect(() => {
    pendingMergeRef.current = false;
    setRows([]);
    setTotal(null);
    setError("");
    setServerOutdated(false);
    if (key) void load("replace");
  }, [key, load]);

  // order:buckets 틱(또는 폴백 폴링) → 병합 재조회.
  const firstSignalRef = useRef(true);
  useEffect(() => {
    if (firstSignalRef.current) {
      firstSignalRef.current = false;
      return;
    }
    requestMerge();
  }, [refreshSignal, requestMerge]);

  // 보류 해제 시 1회.
  useEffect(() => {
    if (!paused && pendingMergeRef.current) {
      pendingMergeRef.current = false;
      void load("merge");
    }
  }, [paused, load]);

  // 이 단말 전이 결과 — 행 내용을 즉시 제자리 갱신 + 이탈 시 결과 태그용 status 기억.
  const applyLocalResult = useCallback(
    (id: number, patch: Partial<OrderSummary> & { status: OrderStatus }) => {
      knownStatusRef.current.set(id, patch.status);
      setRows((prev) => patchTriageRow(prev, id, patch));
    },
    [],
  );

  return {
    rows,
    loading,
    error,
    serverOutdated,
    total,
    loadedAt,
    reload: load,
    requestMerge,
    applyLocalResult,
  };
}

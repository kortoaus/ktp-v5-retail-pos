// OrdersScreen — 매장 온라인 주문 트리아지 (2026-09-24 트리아지 스펙 §6, 1366×768).
//
//  1단 바(56px): ←Back │ [New][Pickup][Delivery][Issues] │ 검색 │ History │ ⟳ hh:mm
//  2단 칩(44px): Pickup = Today·Ready·Upcoming / Delivery = Today·Out·Next: Ddd D Mmm·Upcoming
//               / New = All·Pickup·Delivery / Issues = All + 종류별(카운트>0)
//  (Delivery Next/Today/Upcoming) 작업 줄(40px): 일괄 Schedule·Dispatch + 인쇄
//  전체폭 목록(행 56px) + 기존 모달 뷰어.
//
// 분류·카운트·이슈는 전부 crm (order:buckets 소켓 30s + 목록 triage 필드). 클라는 그리기만.
// 자동 갱신은 위치 유지 병합, 서버 순서 전체 교체는 수동 ⟳ · 칩/버킷 전환 때만.
// 칩 선택은 1단별로 세션 동안 기억(모듈 메모리 — 재기동 시 초기화).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import BlockScreen from "../components/BlockScreen";
import KeyboardInputText from "../components/KeyboardInputText";
import ServerPagingList from "../components/list/ServerPagingList";
import { useUser } from "../contexts/UserContext";
import hasScope from "../libs/scope-utils";
import { cn } from "../libs/cn";
import dayjsAU from "../libs/dayjsAU";
import { PagingType } from "../libs/api";
import {
  bulkTransitionOrders,
  getDeliveryManifest,
  getOrders,
  recordOrdersPrintedBulk,
  scheduleOrder,
  type OrderDetail,
  type OrderSummary,
} from "../service/order.service";
import OrderViewer from "../components/orders/OrderViewer";
import TriageOrderRow from "../components/orders/TriageOrderRow";
import TriageConfirmDialog from "../components/orders/TriageConfirmDialog";
import {
  getOrderInboxState,
  subscribeOrderInbox,
} from "../components/orders/orderInboxStore";
import { pollOrderBucketsNow, useBucketsFallback } from "../components/orders/useBucketsFallback";
import { useTriageList, type TriageListSource } from "../components/orders/useTriageList";
import {
  bulkTargets,
  dispatchConfirmText,
  paymentFailureMessage,
  runDeliveryBulk,
  scheduleConfirmText,
  selectableIds,
  sumTotals,
  todaySummaryText,
  tomorrowSummaryText,
  type BulkConfirmText,
  type BulkItemResult,
  type BulkKind,
} from "../components/orders/delivery-bulk";
import {
  chipsForLevel1,
  DEFAULT_CHIPS,
  formatDayLabel,
  level1Counts,
  level1Tone,
  nextDeliveryChipLabel,
  TRIAGE_LIST_LIMIT,
  viewFromBucketParam,
  type TriageLevel1,
  type TriageView,
} from "../components/orders/triage-format";
import { replaceTriageRows } from "../components/orders/triage-merge";
import {
  buildPackingSlipModel,
  buildPickSummaryModel,
} from "../components/orders/pick-list-render";
import { printOrderPickList } from "../libs/printer/order-pick-list-receipt";
import { printDeliveryPickSummary } from "../libs/printer/delivery-pick-summary-receipt";

// 1단별 칩 기억 — 세션(프로세스) 동안만.
const chipMemory: Record<TriageLevel1, string> = { ...DEFAULT_CHIPS };

// 진입 파라미터 → 화면. 명시 버킷(?bucket=new 배너·버튼·홈, pickup.* 등)은 그 버킷의
// 기본 칩으로 열고 기억도 갱신한다. 파라미터 없음 = New + 기억한 칩.
function viewForEntry(param: string | null): TriageView {
  const v = viewFromBucketParam(param);
  if (!param) return { level1: v.level1, chip: chipMemory[v.level1] };
  chipMemory[v.level1] = v.chip;
  return v;
}

const LEVEL1: { key: TriageLevel1; label: string }[] = [
  { key: "new", label: "New" },
  { key: "pickup", label: "Pickup" },
  { key: "delivery", label: "Delivery" },
  { key: "issues", label: "Issues" },
];

const HISTORY_PAGE_SIZE = 10;

type Mode = "triage" | "history";

type PendingConfirm = {
  text: BulkConfirmText;
  tone?: "blue" | "red";
  run: () => Promise<void>;
};

type Notice = { tone: "info" | "error"; text: string };

export default function OrdersScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading: userLoading } = useUser();
  const inbox = useSyncExternalStore(subscribeOrderInbox, getOrderInboxState);
  const buckets = inbox.buckets;
  useBucketsFallback();

  // --- 화면 상태 ---
  const bucketParam = searchParams.get("bucket");
  const [view, setView] = useState<TriageView>(() => viewForEntry(bucketParam));
  const [mode, setMode] = useState<Mode>("triage");
  const [keyword, setKeyword] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [viewingOrderId, setViewingOrderId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkResults, setBulkResults] = useState<Map<number, BulkItemResult>>(new Map());
  const [busy, setBusy] = useState<string | null>(null); // "Charging 3/9…" / "Printing 3/9"
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // 배너/버튼이 ?bucket= 로 다시 들어오면 그 버킷으로 (화면 안 전환은 lastParamRef 로 무시).
  const lastParamRef = useRef(bucketParam);
  useEffect(() => {
    if (lastParamRef.current === bucketParam) return;
    lastParamRef.current = bucketParam;
    setMode("triage");
    setKeyword("");
    setKeywordDraft("");
    setSelected(new Set());
    setBulkResults(new Map());
    setView(viewForEntry(bucketParam));
  }, [bucketParam]);

  const selectView = useCallback(
    (next: TriageView) => {
      chipMemory[next.level1] = next.chip;
      setView(next);
      setMode("triage");
      setKeyword("");
      setKeywordDraft("");
      setSelected(new Set());
      setBulkResults(new Map());
      setNotice(null);
      const param = next.level1 === "new" || next.level1 === "issues" ? next.level1 : next.chip;
      lastParamRef.current = param;
      setSearchParams({ bucket: param }, { replace: true });
    },
    [setSearchParams],
  );

  // --- 목록 ---
  const paused = viewingOrderId != null || busy != null || confirm != null;
  const source: TriageListSource | null =
    mode !== "triage"
      ? null
      : keyword
        ? { kind: "search", keyword }
        : { kind: "bucket", view };
  const list = useTriageList(source, inbox.bucketsSeq, paused);

  // 뷰어 닫힘·일괄 종료 후 1회 병합 (paused 해제는 훅이 처리 — 여기선 자기 액션 신호만).
  const onViewerChanged = useCallback(
    (detail?: OrderDetail) => {
      if (detail) {
        list.applyLocalResult(detail.id, {
          status: detail.status,
          version: detail.version,
          payment: { ...detail.payment },
          triage: detail.triage,
        });
      }
      list.requestMerge();
    },
    [list],
  );

  // --- History (종결, 기존 10행 페이징) ---
  const [historyRows, setHistoryRows] = useState<OrderSummary[]>([]);
  const [historyPaging, setHistoryPaging] = useState<PagingType | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const fetchHistory = useCallback(async (page: number) => {
    setHistoryLoading(true);
    const params = new URLSearchParams({
      preset: "history",
      page: String(page),
      limit: String(HISTORY_PAGE_SIZE),
    });
    const res = await getOrders(`?${params}`);
    setHistoryLoading(false);
    if (res.ok && res.result) {
      setHistoryRows(res.result);
      setHistoryPaging(res.paging);
    } else {
      setHistoryRows([]);
      setHistoryPaging(null);
      setNotice({ tone: "error", text: res.msg || "Failed to load history" });
    }
  }, []);
  useEffect(() => {
    if (mode === "history") void fetchHistory(1);
  }, [mode, fetchHistory]);

  // --- 파생 ---
  const today = buckets?.today ?? dayjsAU().format("YYYY-MM-DD");
  const counts = level1Counts(buckets);
  const chips = chipsForLevel1(view.level1, buckets, view.chip);
  const bucketChip = mode === "triage" && !keyword && view.level1 === "delivery" ? view.chip : null;
  const workBar: "tomorrow" | "today" | "upcoming" | null =
    bucketChip === "delivery.tomorrow"
      ? "tomorrow"
      : bucketChip === "delivery.today"
        ? "today"
        : bucketChip === "delivery.upcoming"
          ? "upcoming"
          : null;
  const liveOrders = list.rows.filter((r) => !r.gone).map((r) => r.order);
  const listOrders = list.rows.map((r) => r.order);

  if (userLoading) {
    return <div className="flex items-center justify-center h-full text-gray-400">Loading...</div>;
  }
  if (!user || !hasScope(user.scope, ["sale"])) {
    return <BlockScreen label="You are not authorized to access this page" link="/" />;
  }

  // --- 액션 ---
  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFor(kind: BulkKind) {
    const ids = selectableIds(liveOrders, kind);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(ids));
  }

  function manualRefresh() {
    setBulkResults(new Map());
    void pollOrderBucketsNow();
    if (mode === "history") void fetchHistory(historyPaging?.currentPage ?? 1);
    else void list.reload("replace");
  }

  function askBulk(kind: BulkKind) {
    const targets = bulkTargets(liveOrders, selected, kind);
    if (targets.length === 0) return;
    const text =
      kind === "schedule"
        ? scheduleConfirmText(targets.length, sumTotals(targets))
        : dispatchConfirmText(targets.length);
    setConfirm({
      text,
      run: async () => {
        setBusy(`${kind === "schedule" ? "Charging" : "Dispatching"} 0/${targets.length}…`);
        try {
          const results = await runDeliveryBulk(
            kind,
            targets,
            (k, orders) => bulkTransitionOrders(k, orders),
            (done, total) =>
              setBusy(`${kind === "schedule" ? "Charging" : "Dispatching"} ${done}/${total}…`),
          );
          setBulkResults((prev) => new Map([...prev, ...results]));
          let ok = 0;
          for (const [id, r] of results) {
            if (r.ok) {
              ok += 1;
              list.applyLocalResult(id, { status: r.status, version: r.version });
            }
          }
          const failed = results.size - ok;
          setSelected((prev) => new Set([...prev].filter((id) => !results.get(id)?.ok)));
          setNotice({
            tone: failed > 0 ? "error" : "info",
            text:
              failed > 0
                ? `${ok} done, ${failed} failed — see the red rows.`
                : `${ok} ${kind === "schedule" ? "scheduled and charged" : "dispatched"}.`,
          });
        } finally {
          setBusy(null);
          list.requestMerge();
          void pollOrderBucketsNow();
        }
      },
    });
  }

  function askRowSchedule(order: OrderSummary) {
    setConfirm({
      text: {
        title: `Schedule order ${order.orderNo}?`,
        lines: ["The customer's card will be charged now.", "Customer will be notified."],
        confirmLabel: "Schedule & charge",
      },
      run: async () => {
        setBusy("Charging…");
        try {
          const res = await scheduleOrder(order.id, order.version);
          if (res.ok && res.result) {
            setBulkResults((prev) => new Map(prev).set(order.id, {
              ok: true,
              label: "Scheduled",
              status: res.result!.status,
              version: res.result!.version,
            }));
            list.applyLocalResult(order.id, { status: res.result.status, version: res.result.version });
          } else {
            const message =
              paymentFailureMessage(res.msg, res.result) ??
              (res.status === 409 ? "Order was updated elsewhere — refresh and check it." : res.msg || "Failed to schedule");
            setBulkResults((prev) => new Map(prev).set(order.id, { ok: false, message }));
          }
        } finally {
          setBusy(null);
          list.requestMerge();
        }
      },
    });
  }

  async function printPickSummary() {
    const date = buckets?.nextDeliveryDate;
    if (!date) {
      setNotice({ tone: "error", text: "No next delivery day — check delivery settings." });
      return;
    }
    setBusy("Printing pick summary…");
    try {
      const res = await getDeliveryManifest({ date });
      if (!res.ok || !res.result) {
        setNotice({ tone: "error", text: res.msg || "Failed to load the delivery manifest" });
        return;
      }
      if (res.result.orders.length === 0) {
        setNotice({ tone: "info", text: `No orders for ${formatDayLabel(date)}.` });
        return;
      }
      const printed = await printDeliveryPickSummary(buildPickSummaryModel(res.result, new Date()));
      setNotice(
        printed.ok
          ? { tone: "info", text: `Pick summary printed (${res.result.orders.length} orders).` }
          : { tone: "error", text: `Pick summary not printed: ${printed.message}` },
      );
    } finally {
      setBusy(null);
    }
  }

  async function printPackingSlips() {
    const chosen = listOrders.filter((o) => selected.has(o.id));
    if (chosen.length === 0) return;
    setBusy(`Printing 0/${chosen.length}`);
    try {
      const res = await getDeliveryManifest({ ids: chosen.map((o) => o.id) });
      if (!res.ok || !res.result) {
        setNotice({ tone: "error", text: res.msg || "Failed to load the delivery manifest" });
        return;
      }
      const byId = new Map(res.result.orders.map((o) => [o.id, o]));
      const printable = chosen.filter((o) => byId.has(o.id));
      const skipped = chosen.length - printable.length;
      const printedAt = new Date(); // 배치 1회 고정 (A4)
      const printedIds: number[] = [];
      let failure: string | null = null;
      for (let i = 0; i < printable.length; i += 1) {
        setBusy(`Printing ${i + 1}/${printable.length}`);
        const order = printable[i];
        const model = buildPackingSlipModel(byId.get(order.id)!, order.deliveryEtaDate, {
          printedAt,
          index: i + 1,
          count: printable.length,
        });
        const result = await printOrderPickList(model);
        if (!result.ok) {
          failure = `Printing stopped at ${i + 1}/${printable.length}: ${result.message}`;
          break;
        }
        printedIds.push(order.id);
      }
      if (printedIds.length > 0) {
        const rec = await recordOrdersPrintedBulk(printedIds.map((id) => ({ id, kind: "picklist" as const })));
        if (!rec.ok) console.error("[packing-slips] printed record failed:", rec.msg);
      }
      const skippedText = skipped > 0 ? ` ${skipped} skipped (only unscheduled/scheduled deliveries print).` : "";
      setNotice(
        failure
          ? { tone: "error", text: `${failure}. ${printedIds.length} printed.${skippedText}` }
          : { tone: "info", text: `${printedIds.length} packing slip${printedIds.length === 1 ? "" : "s"} printed.${skippedText}` },
      );
    } finally {
      setBusy(null);
    }
  }

  const scheduleTargets = bulkTargets(liveOrders, selected, "schedule");
  const dispatchTargets = bulkTargets(liveOrders, selected, "dispatch");
  const selectedCount = listOrders.filter((o) => selected.has(o.id)).length;
  const loadedAtLabel =
    mode === "history" ? "" : list.loadedAt ? dayjsAU(list.loadedAt).format("HH:mm") : "";

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 1단 바 (56px) */}
      <div className="h-14 shrink-0 px-3 flex items-center gap-2 border-b border-gray-200">
        <button
          type="button"
          onPointerDown={() => navigate("/")}
          className="h-11 px-3 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-semibold"
        >
          ← Back
        </button>
        <div className="flex gap-1.5">
          {LEVEL1.map((seg) => {
            const count = counts[seg.key];
            const tone = level1Tone(seg.key, count);
            const active = mode === "triage" && !keyword && view.level1 === seg.key;
            return (
              <button
                key={seg.key}
                type="button"
                onPointerDown={() => selectView({ level1: seg.key, chip: chipMemory[seg.key] })}
                className={cn(
                  "h-11 min-w-[128px] px-3 rounded-lg border-2 flex items-center justify-between gap-3 text-base font-bold",
                  active ? "border-blue-600" : "border-transparent",
                  tone === "orange" && "bg-orange-500 text-white",
                  tone === "red" && "bg-red-600 text-white",
                  tone === "gray" && (active ? "bg-blue-50 text-blue-800" : "bg-gray-100 text-gray-700"),
                )}
              >
                <span>{seg.label}</span>
                <span className={cn("tabular-nums", tone === "gray" && "text-gray-500")}>
                  {count ?? "—"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2 justify-end">
          <KeyboardInputText
            value={keywordDraft}
            onChange={setKeywordDraft}
            onEnter={() => {
              const term = keywordDraft.trim().replace(/\s+/g, " ");
              setMode("triage");
              setKeyword(term);
              setSelected(new Set());
            }}
            placeholder="Search order / phone / name"
            initialLayout="english"
            className="w-64 h-11"
          />
          <button
            type="button"
            onPointerDown={() => {
              setKeyword("");
              setKeywordDraft("");
              setMode(mode === "history" ? "triage" : "history");
            }}
            className={cn(
              "h-11 px-3 rounded-lg text-sm font-semibold",
              mode === "history" ? "bg-blue-600 text-white" : "bg-gray-100 active:bg-gray-200",
            )}
          >
            History
          </button>
          <button
            type="button"
            onPointerDown={manualRefresh}
            disabled={busy != null}
            className="h-11 px-3 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-semibold tabular-nums disabled:opacity-40"
          >
            ⟳ {loadedAtLabel}
          </button>
        </div>
      </div>

      {/* 2단 칩 (44px) / 검색·History 안내 */}
      <div className="h-11 shrink-0 px-3 flex items-center gap-2 border-b border-gray-200 bg-gray-50">
        {mode === "history" ? (
          <span className="text-sm text-gray-600">History — completed, delivered, rejected, cancelled and expired orders</span>
        ) : keyword ? (
          <>
            <span className="text-sm">
              Search <span className="font-bold">"{keyword}"</span> · {list.rows.length} found (active orders)
            </span>
            <button
              type="button"
              onPointerDown={() => {
                setKeyword("");
                setKeywordDraft("");
              }}
              className="h-8 px-3 rounded-lg bg-white border border-gray-300 text-sm font-semibold active:bg-gray-100"
            >
              Clear
            </button>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-gray-500 w-20">
              {LEVEL1.find((l) => l.key === view.level1)?.label}:
            </span>
            {chips.map((chip) => {
              const active = view.chip === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onPointerDown={() => selectView({ level1: view.level1, chip: chip.key })}
                  className={cn(
                    "h-8 px-3 rounded-full text-sm font-semibold flex items-center gap-2 border",
                    active
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "bg-white border-gray-300 text-gray-700 active:bg-gray-100",
                  )}
                >
                  {chip.label}
                  <span className={cn("tabular-nums", !active && (chip.count ? "text-gray-900" : "text-gray-400"))}>
                    {chip.count ?? "—"}
                  </span>
                </button>
              );
            })}
            {buckets == null && (
              <span className="ml-auto text-xs text-gray-400">Counts unavailable</span>
            )}
          </>
        )}
      </div>

      {/* 작업 줄 (40px) — Delivery Next / Today / Upcoming */}
      {workBar && (
        <div className="h-11 shrink-0 px-3 flex items-center gap-2 border-b border-gray-200">
          <span className="text-sm font-semibold text-gray-700 truncate min-w-0 flex-1">
            {workBar === "today"
              ? todaySummaryText(liveOrders)
              : workBar === "tomorrow"
                ? tomorrowSummaryText(
                    nextDeliveryChipLabel(buckets?.nextDeliveryDate ?? null).replace(/^Next: /, ""),
                    liveOrders,
                  )
                : `Upcoming · ${liveOrders.length} orders`}
          </span>
          {workBar === "today" ? (
            <>
              <WorkButton onPress={() => selectAllFor("dispatch")} disabled={busy != null}>
                Select to dispatch
              </WorkButton>
              <WorkButton
                primary
                onPress={() => askBulk("dispatch")}
                disabled={busy != null || dispatchTargets.length === 0}
              >
                Dispatch selected ({dispatchTargets.length})
              </WorkButton>
            </>
          ) : (
            <>
              <WorkButton onPress={() => selectAllFor("schedule")} disabled={busy != null}>
                Select to schedule
              </WorkButton>
              <WorkButton
                primary
                onPress={() => askBulk("schedule")}
                disabled={busy != null || scheduleTargets.length === 0}
              >
                Schedule & charge ({scheduleTargets.length})
              </WorkButton>
            </>
          )}
          {workBar !== "upcoming" && (
            <>
              <span className="w-px h-6 bg-gray-300" />
              {workBar === "tomorrow" && (
                <WorkButton onPress={() => void printPickSummary()} disabled={busy != null}>
                  Print pick summary
                </WorkButton>
              )}
              <WorkButton
                onPress={() => void printPackingSlips()}
                disabled={busy != null || selectedCount === 0}
              >
                Print packing slips ({selectedCount})
              </WorkButton>
            </>
          )}
        </div>
      )}

      {(notice || busy) && (
        <div
          className={cn(
            "shrink-0 px-4 py-2 flex items-center gap-3 text-sm font-semibold",
            busy
              ? "bg-blue-50 text-blue-800"
              : notice?.tone === "error"
                ? "bg-red-50 text-red-700"
                : "bg-emerald-50 text-emerald-800",
          )}
        >
          <span className="flex-1">{busy ?? notice?.text}</span>
          {!busy && (
            <button
              type="button"
              onPointerDown={() => setNotice(null)}
              className="h-8 w-8 rounded-lg active:bg-black/10"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* 목록 */}
      <div className="flex-1 min-h-0 relative">
        {mode === "history" ? (
          historyRows.length === 0 && !historyLoading ? (
            <Empty text="No orders" />
          ) : (
            <ServerPagingList
              rows={replaceTriageRows(historyRows)}
              pageSize={HISTORY_PAGE_SIZE}
              paging={historyPaging}
              onPageChange={(page) => void fetchHistory(page)}
              Renderer={({ item }) => (
                <TriageOrderRow
                  row={item}
                  today={today}
                  selectable={false}
                  selected={false}
                  onToggleSelect={() => undefined}
                  onOpen={setViewingOrderId}
                />
              )}
            />
          )
        ) : list.serverOutdated ? (
          <Empty text="Server update required — this order server does not support the new order lists yet." />
        ) : list.rows.length === 0 ? (
          <Empty text={list.loading ? "Loading…" : list.error || (keyword ? "No matching active orders" : "Nothing here")} />
        ) : (
          <div className="h-full overflow-y-auto">
            {list.rows.map((row) => (
              <TriageOrderRow
                key={row.order.id}
                row={row}
                today={today}
                selectable={workBar != null}
                selected={selected.has(row.order.id)}
                result={bulkResults.get(row.order.id)}
                rowAction={
                  workBar === "today" &&
                  !row.gone &&
                  row.order.status === "ACCEPTED" &&
                  !bulkResults.get(row.order.id)?.ok
                    ? { label: "Schedule", disabled: busy != null, onPress: () => askRowSchedule(row.order) }
                    : null
                }
                onToggleSelect={toggleSelect}
                onOpen={setViewingOrderId}
              />
            ))}
            {list.total != null && list.total > TRIAGE_LIST_LIMIT && (
              <div className="h-12 flex items-center justify-center text-sm text-gray-500">
                Showing {TRIAGE_LIST_LIMIT} of {list.total} — use search
              </div>
            )}
          </div>
        )}
      </div>

      <OrderViewer
        orderId={viewingOrderId}
        deliveryWindow={buckets?.deliveryWindow ?? null}
        onClose={() => setViewingOrderId(null)}
        onChanged={onViewerChanged}
      />

      {confirm && (
        <TriageConfirmDialog
          text={confirm.text}
          tone={confirm.tone}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const run = confirm.run;
            setConfirm(null);
            void run();
          }}
        />
      )}
    </div>
  );
}

function WorkButton({
  children,
  onPress,
  disabled,
  primary,
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={() => {
        if (!disabled) onPress();
      }}
      className={cn(
        "h-9 px-3 shrink-0 rounded-lg text-sm font-bold disabled:opacity-40 whitespace-nowrap",
        primary ? "bg-blue-600 text-white active:bg-blue-700" : "bg-gray-100 text-gray-800 active:bg-gray-200",
      )}
    >
      {children}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-gray-400 text-sm px-6 text-center">{text}</div>;
}

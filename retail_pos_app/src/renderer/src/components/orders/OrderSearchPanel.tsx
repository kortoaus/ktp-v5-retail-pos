// OrderSearchPanel — 주문 수신함 목록.
// 프리셋 탭 + C&C/Delivery 토글 + ServerPagingList 10행.
// 슬라이스 B: 행 탭 → onSelect(orderId) (Screen 이 OrderViewer 를 연다),
// refreshKey 증가 → 현재 페이지 재조회 (전이 후 onChanged 훅).

import { useCallback, useEffect, useRef, useState } from "react";
import LoadingOverlay from "../LoadingOverlay";
import ServerPagingList from "../list/ServerPagingList";
import { PagingType } from "../../libs/api";
import { cn } from "../../libs/cn";
import dayjsAU from "../../libs/dayjsAU";
import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";
import {
  getOrders,
  type OrderFulfillment,
  type OrderPreset,
  type OrderStatus,
  type OrderSummary,
} from "../../service/order.service";
import { FulfillmentBadge, StatusBadge } from "./order-badges";

const PAGE_SIZE = 10;

const PRESETS: { key: OrderPreset; label: string }[] = [
  { key: "new", label: "New" },
  { key: "dueSoon", label: "Due 2h" },
  { key: "today", label: "Today" },
  { key: "active", label: "Active" },
  { key: "history", label: "History" },
];

type FulfillmentFilter = "ALL" | OrderFulfillment;
const FULFILLMENT_FILTERS: { key: FulfillmentFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "CLICK_AND_COLLECT", label: "C&C" },
  { key: "DELIVERY", label: "Delivery" },
];

const ACTIVE_STATUSES: OrderStatus[] = ["PLACED", "ACCEPTED", "READY"];

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

// "YYYY-MM-DD" 표시용 — tz 시프트를 피하려고 문자열에서 직접 뽑는다.
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
function fmtDateOnly(dateStr: string): string {
  const [, monthStr, dayStr] = dateStr.split("-");
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !MONTH_LABELS[month - 1]) {
    return dateStr;
  }
  return `${day} ${MONTH_LABELS[month - 1]}`;
}

// pickupSlotMinutes = minute-of-day → "HH:mm"
function fmtSlotMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtPlacedAt(iso: string): string {
  const d = dayjsAU(iso);
  return d.isSame(dayjsAU(), "day") ? d.format("HH:mm") : d.format("D MMM HH:mm");
}

// 수령예정 표시 — C&C: 슬롯 HH:mm (+ 오늘 아니면 날짜), DELIVERY: ETA 날짜만.
// dueAt 재계산 금지 — 표시는 원본 필드, 과기한 판정만 서버 dueAt 비교.
function fmtDue(order: OrderSummary, todayStr: string): string {
  if (order.fulfillment === "CLICK_AND_COLLECT") {
    if (order.pickupSlotMinutes == null) return "—";
    const time = fmtSlotMinutes(order.pickupSlotMinutes);
    if (order.pickupDate && order.pickupDate !== todayStr) {
      return `${fmtDateOnly(order.pickupDate)} ${time}`;
    }
    return time;
  }
  if (!order.deliveryEtaDate) return "—";
  return order.deliveryEtaDate === todayStr
    ? "Today"
    : fmtDateOnly(order.deliveryEtaDate);
}

function isOverdue(order: OrderSummary, nowMs: number): boolean {
  if (!order.dueAt) return false;
  if (!ACTIVE_STATUSES.includes(order.status)) return false;
  return new Date(order.dueAt).getTime() < nowMs;
}

interface OrderSearchPanelProps {
  onSelect: (orderId: number) => void;
  // 증가할 때마다 현재 페이지 재조회 — OrderViewer 전이 성공(onChanged) 훅.
  refreshKey: number;
}

export default function OrderSearchPanel({
  onSelect,
  refreshKey,
}: OrderSearchPanelProps) {
  const [preset, setPreset] = useState<OrderPreset>("active");
  const [fulfillment, setFulfillment] = useState<FulfillmentFilter>("ALL");
  const [items, setItems] = useState<OrderSummary[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchPage = useCallback(
    async (page: number) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          preset,
          page: String(page),
          limit: String(PAGE_SIZE),
        });
        if (fulfillment !== "ALL") params.set("fulfillment", fulfillment);
        const res = await getOrders(`?${params}`);
        if (res.ok && res.result) {
          setItems(res.result);
          setPaging(res.paging);
        } else {
          setItems([]);
          setPaging(null);
          setError(res.msg || "Failed to load orders");
        }
      } finally {
        setLoading(false);
      }
    },
    [preset, fulfillment],
  );

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  // refreshKey 증가 시 현재 페이지 재조회. lastRefreshKeyRef 가드로
  // fetchPage(프리셋/필터) 변경만으로는 중복 조회하지 않는다.
  const pagingRef = useRef<PagingType | null>(null);
  pagingRef.current = paging;
  const lastRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === lastRefreshKeyRef.current) return;
    lastRefreshKeyRef.current = refreshKey;
    fetchPage(pagingRef.current?.currentPage ?? 1);
  }, [refreshKey, fetchPage]);

  const nowMs = Date.now();
  const todayStr = dayjsAU().format("YYYY-MM-DD");

  return (
    <div className="flex flex-col h-full relative">
      {loading && <LoadingOverlay label="Loading orders..." />}

      {/* Filter bar */}
      <div className="p-3 border-b border-gray-200 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onPointerDown={() => setPreset(p.key)}
              className={cn(
                "px-5 h-12 text-base font-semibold border-r last:border-r-0 border-gray-300",
                preset === p.key
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 active:bg-gray-100",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {FULFILLMENT_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onPointerDown={() => setFulfillment(f.key)}
              className={cn(
                "px-5 h-12 text-base font-semibold border-r last:border-r-0 border-gray-300",
                fulfillment === f.key
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 active:bg-gray-100",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />
        <button
          type="button"
          onPointerDown={() => fetchPage(paging?.currentPage ?? 1)}
          disabled={loading}
          className="h-12 px-5 rounded-lg bg-gray-200 text-base font-semibold active:bg-gray-300 disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0">
        {items.length === 0 && !loading ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            {error || "No orders"}
          </div>
        ) : (
          <ServerPagingList
            rows={items}
            pageSize={PAGE_SIZE}
            paging={paging}
            onPageChange={fetchPage}
            Renderer={({ item }) => (
              <OrderRow
                order={item}
                nowMs={nowMs}
                todayStr={todayStr}
                onSelect={onSelect}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}

// 슬라이스 B: 행 탭 → onSelect(order.id) (onPointerDown — 스캐너 트랩 관례).
function OrderRow({
  order,
  nowMs,
  todayStr,
  onSelect,
}: {
  order: OrderSummary;
  nowMs: number;
  todayStr: string;
  onSelect: (orderId: number) => void;
}) {
  const overdue = isOverdue(order, nowMs);
  const firstLineName =
    order.firstLineNameEn ?? order.firstLineNameKo ?? "—";
  const lineSummary =
    order.lineCount > 1
      ? `${firstLineName} +${order.lineCount - 1}`
      : firstLineName;

  return (
    <div
      onPointerDown={() => onSelect(order.id)}
      className={cn(
        "h-full flex items-center gap-3 px-4 text-base border-l-4 border-l-transparent cursor-pointer active:bg-gray-100",
        overdue && "bg-red-50 border-l-red-500",
      )}
    >
      <span className="w-24 shrink-0 text-sm text-gray-500 tabular-nums">
        {fmtPlacedAt(order.placedAt)}
      </span>
      <span className="w-32 shrink-0 font-mono text-sm">{order.orderNo}</span>
      <FulfillmentBadge fulfillment={order.fulfillment} />
      <span className="w-44 shrink-0 truncate">
        {order.memberName}{" "}
        <span className="text-gray-400 text-sm">
          (…{order.memberPhoneLast3})
        </span>
      </span>
      <span className="flex-1 min-w-0 truncate text-gray-600">
        <span className="text-sm text-gray-400 mr-1">{order.lineCount}×</span>
        {lineSummary}
      </span>
      <span className="w-20 shrink-0 text-right font-mono">
        ${fmtMoney(order.total)}
      </span>
      <span
        className={cn(
          "w-28 shrink-0 text-sm tabular-nums",
          overdue ? "text-red-600 font-bold" : "text-gray-600",
        )}
      >
        {fmtDue(order, todayStr)}
      </span>
      <StatusBadge status={order.status} />
    </div>
  );
}

// FulfillmentBadge / StatusBadge 는 order-badges.tsx 로 분리 (뷰어와 공용).

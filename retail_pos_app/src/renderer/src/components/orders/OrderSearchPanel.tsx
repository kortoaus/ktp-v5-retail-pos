// OrderSearchPanel — 주문 수신함 목록 (슬라이스 A: 조회 전용).
// 프리셋 탭 + C&C/Delivery 토글 + ServerPagingList 20행.
// 행 탭 무동작 — 디테일 화면은 슬라이스 B.

import { useCallback, useEffect, useState } from "react";
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

const PAGE_SIZE = 20;

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

export default function OrderSearchPanel() {
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
                "px-4 h-10 text-sm font-medium border-r last:border-r-0 border-gray-300",
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
                "px-4 h-10 text-sm font-medium border-r last:border-r-0 border-gray-300",
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
          className="h-10 px-4 rounded-lg bg-gray-200 text-sm font-medium active:bg-gray-300 disabled:opacity-40"
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
              <OrderRow order={item} nowMs={nowMs} todayStr={todayStr} />
            )}
          />
        )}
      </div>
    </div>
  );
}

// 행은 이번 슬라이스에서 비인터랙티브 — onPointerDown 없음 (디테일은 B).
function OrderRow({
  order,
  nowMs,
  todayStr,
}: {
  order: OrderSummary;
  nowMs: number;
  todayStr: string;
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
      className={cn(
        "h-full flex items-center gap-3 px-4 text-sm border-l-4 border-l-transparent",
        overdue && "bg-red-50 border-l-red-500",
      )}
    >
      <span className="w-24 shrink-0 text-xs text-gray-500 tabular-nums">
        {fmtPlacedAt(order.placedAt)}
      </span>
      <span className="w-28 shrink-0 font-mono text-xs">{order.orderNo}</span>
      <FulfillmentBadge fulfillment={order.fulfillment} />
      <span className="w-44 shrink-0 truncate">
        {order.memberName}{" "}
        <span className="text-gray-400 text-xs">
          (…{order.memberPhoneLast3})
        </span>
      </span>
      <span className="flex-1 min-w-0 truncate text-gray-600">
        <span className="text-xs text-gray-400 mr-1">{order.lineCount}×</span>
        {lineSummary}
      </span>
      <span className="w-20 shrink-0 text-right font-mono">
        ${fmtMoney(order.total)}
      </span>
      <span
        className={cn(
          "w-28 shrink-0 text-xs tabular-nums",
          overdue ? "text-red-600 font-bold" : "text-gray-600",
        )}
      >
        {fmtDue(order, todayStr)}
      </span>
      <StatusBadge status={order.status} />
    </div>
  );
}

function FulfillmentBadge({ fulfillment }: { fulfillment: OrderFulfillment }) {
  const isCnc = fulfillment === "CLICK_AND_COLLECT";
  return (
    <span
      className={cn(
        "w-12 shrink-0 text-center text-[10px] font-bold px-1.5 py-1 rounded tracking-wider",
        isCnc ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700",
      )}
    >
      {isCnc ? "C&C" : "DLV"}
    </span>
  );
}

const STATUS_BADGE_CLASSES: Record<OrderStatus, string> = {
  PLACED: "bg-orange-100 text-orange-700",
  ACCEPTED: "bg-blue-100 text-blue-700",
  READY: "bg-emerald-100 text-emerald-700",
  COLLECTED: "bg-gray-100 text-gray-600",
  CANCELLED: "bg-gray-200 text-gray-500",
  REJECTED: "bg-red-100 text-red-700",
  EXPIRED: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        "w-24 shrink-0 text-center text-[10px] font-bold px-2 py-1 rounded tracking-wider",
        STATUS_BADGE_CLASSES[status],
      )}
    >
      {status}
    </span>
  );
}

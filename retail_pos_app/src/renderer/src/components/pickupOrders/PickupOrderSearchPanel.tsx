import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Dayjs } from "dayjs";
import KeyboardInputText from "../KeyboardInputText";
import DateRangeSelector from "../DateRangeSelector";
import MemberSearchModal, {
  type MemberSearchSelection,
} from "../MemberSearchModal";
import LoadingOverlay from "../LoadingOverlay";
import type { PagingType } from "../../libs/api";
import { cn } from "../../libs/cn";
import dayjsAU from "../../libs/dayjsAU";
import {
  getPrintedHistorySummaries,
  PRINTED_HISTORY_ENTITY_PICKUP_ORDER,
  type PrintedHistorySummary,
} from "../../service/printed-history.service";
import { searchPickupOrders } from "../../service/pickup-order.service";
import {
  formatPickupCreatedAt,
  formatPickupDateTimeParts,
  formatPickupMoney,
  statusLabel,
} from "./pickup-order-format";
import {
  POS_PICKUP_ORDER_STATUS_TARGETS,
  type PickupOrderListItem,
  type PickupOrderListSort,
  type PickupOrderStatus,
  type PickupOrderStatusFilter,
} from "./pickup-order-types";

const PAGE_SIZE = 20;
const STATUS_FILTERS: PickupOrderStatusFilter[] = [
  "ALL",
  ...POS_PICKUP_ORDER_STATUS_TARGETS,
];

interface Props {
  onSelect: (order: PickupOrderListItem) => void;
  initialStatusFilter?: PickupOrderStatusFilter;
  initialFrom?: Dayjs | null;
  initialSort?: PickupOrderListSort;
}

export type PickupOrderSearchPanelHandle = {
  markPrinted: (crmOrderId: number) => void;
  markStatusChanged: (crmOrderId: number, status: PickupOrderStatus) => void;
  refreshCurrentPage: () => void;
};

const PickupOrderSearchPanel = forwardRef<PickupOrderSearchPanelHandle, Props>(
  function PickupOrderSearchPanel(
    {
      onSelect,
      initialStatusFilter = "ALL",
      initialFrom = null,
      initialSort = "pickupStartsAtDesc",
    },
    ref,
  ) {
  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState<Dayjs | null>(initialFrom);
  const [to, setTo] = useState<Dayjs | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<PickupOrderStatusFilter>(initialStatusFilter);
  const [member, setMember] = useState<MemberSearchSelection | null>(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [todaySearchToken, setTodaySearchToken] = useState(0);

  const [items, setItems] = useState<PickupOrderListItem[]>([]);
  const [printedSummariesByOrderId, setPrintedSummariesByOrderId] = useState<
    Map<number, PrintedHistorySummary>
  >(new Map());
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latestRequestIdRef = useRef(0);
  const filterVersionRef = useRef(0);

  useEffect(() => {
    filterVersionRef.current += 1;
  }, [keyword, from, to, statusFilter, member]);

  const fetchPage = useCallback(
    async (page: number) => {
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;
      const filterVersion = filterVersionRef.current;
      setLoading(true);
      setError("");
      try {
        const res = await searchPickupOrders({
          page,
          limit: PAGE_SIZE,
          keyword: keyword.trim() || undefined,
          from: from?.toISOString(),
          to: to?.toISOString(),
          status: statusFilter === "ALL" ? undefined : statusFilter,
          memberId: member?.id,
          sort: initialSort,
        });
        if (
          requestId !== latestRequestIdRef.current ||
          filterVersion !== filterVersionRef.current
        ) {
          return;
        }
        if (res.ok && res.result) {
          setItems(res.result);
          setPaging(res.paging);
          const orderIds = res.result.map((order) => order.crmOrderId);
          const printedRes = await getPrintedHistorySummaries(
            PRINTED_HISTORY_ENTITY_PICKUP_ORDER,
            orderIds,
          );
          if (
            requestId !== latestRequestIdRef.current ||
            filterVersion !== filterVersionRef.current
          ) {
            return;
          }
          if (printedRes.ok && Array.isArray(printedRes.result)) {
            setPrintedSummariesByOrderId(
              new Map(
                printedRes.result.map((summary) => [
                  summary.entityId,
                  summary,
                ]),
              ),
            );
          } else {
            setPrintedSummariesByOrderId(new Map());
          }
        } else {
          setItems([]);
          setPrintedSummariesByOrderId(new Map());
          setPaging(res.paging);
          setError(res.msg || "Failed to load pickup orders");
        }
      } finally {
        if (requestId === latestRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [keyword, from, to, statusFilter, member, initialSort],
  );

  const markPrinted = useCallback((crmOrderId: number) => {
    setPrintedSummariesByOrderId((current) => {
      const next = new Map(current);
      const existing = next.get(crmOrderId);
      next.set(crmOrderId, {
        entityId: crmOrderId,
        printCount: (existing?.printCount ?? 0) + 1,
        lastPrintedAt: new Date().toISOString(),
        lastPrintedByUserId: existing?.lastPrintedByUserId ?? null,
        lastPrintedByUserName: existing?.lastPrintedByUserName ?? null,
      });
      return next;
    });
  }, []);

  const markStatusChanged = useCallback(
    (crmOrderId: number, status: PickupOrderStatus) => {
      setItems((current) => {
        if (statusFilter !== "ALL" && statusFilter !== status) {
          return current.filter((item) => item.crmOrderId !== crmOrderId);
        }

        return current.map((item) =>
          item.crmOrderId === crmOrderId ? { ...item, status } : item,
        );
      });
    },
    [statusFilter],
  );

  useImperativeHandle(
    ref,
    () => ({
      markPrinted,
      markStatusChanged,
      refreshCurrentPage: () => {
        void fetchPage(paging?.currentPage ?? 1);
      },
    }),
    [fetchPage, markPrinted, markStatusChanged, paging?.currentPage],
  );

  function search() {
    void fetchPage(1);
  }

  function searchToday() {
    const now = dayjsAU();
    setFrom(now.startOf("day"));
    setTo(now.endOf("day"));
    setTodaySearchToken((token) => token + 1);
  }

  function reset() {
    setKeyword("");
    setFrom(null);
    setTo(null);
    setStatusFilter("ALL");
    setMember(null);
    setError("");
  }

  useEffect(() => {
    void fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (todaySearchToken === 0) return;
    void fetchPage(1);
  }, [todaySearchToken, fetchPage]);

  return (
    <div className="flex flex-col h-full relative">
      {loading && <LoadingOverlay label="Searching..." />}

      <div className="p-3 border-b border-gray-200 flex flex-wrap items-center gap-2">
        <KeyboardInputText
          value={keyword}
          onChange={setKeyword}
          onEnter={search}
          placeholder="Keyword (document / member / item / barcode)"
          className="w-96"
        />
        <DateRangeSelector
          from={from}
          to={to}
          setVal={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
        <button
          type="button"
          onPointerDown={searchToday}
          disabled={loading}
          className="h-9 px-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm font-bold active:bg-blue-100 disabled:opacity-40"
        >
          Today
        </button>

        <div
          onPointerDown={() => {
            if (member) setMember(null);
            else setMemberModalOpen(true);
          }}
          className="h-9 px-3 rounded-lg border border-gray-300 text-sm flex items-center cursor-pointer gap-1"
        >
          {member ? (
            <>
              <span>{member.name}</span>
              <span className="text-gray-400">x</span>
            </>
          ) : (
            <span className="text-gray-400">Any member</span>
          )}
        </div>

        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onPointerDown={() => setStatusFilter(status)}
              className={cn(
                "px-3 h-9 text-xs font-medium border-r last:border-r-0 border-gray-300",
                statusFilter === status
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 active:bg-gray-100",
              )}
            >
              {statusLabelForFilter(status)}
            </button>
          ))}
        </div>

        <div className="flex-1" />
        <button
          type="button"
          onPointerDown={reset}
          className="h-9 px-3 rounded-lg bg-gray-200 text-sm font-medium active:bg-gray-300"
        >
          Reset
        </button>
        <button
          type="button"
          onPointerDown={search}
          disabled={loading}
          className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-bold active:bg-blue-700 disabled:opacity-40"
        >
          Search
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 border-b border-red-100 bg-red-50 text-red-700 text-xs">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {items.length === 0 && !loading ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            No pickup orders
          </div>
        ) : (
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[170px]" />
              <col className="w-[122px]" />
              <col className="w-[138px]" />
              <col className="w-[82px]" />
              <col className="w-[138px]" />
              <col className="w-[150px]" />
              <col />
              <col className="w-[148px]" />
              <col className="w-[112px]" />
            </colgroup>
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr className="border-b border-gray-200">
                <th className="text-left p-2">
                  Document
                </th>
                <th className="text-left p-2">
                  Status
                </th>
                <th colSpan={3} className="text-left p-2">
                  Pick up start at
                </th>
                <th className="text-left p-2">
                  Member
                </th>
                <th className="text-left p-2">
                  First item
                </th>
                <th className="text-left p-2">
                  Created at
                </th>
                <th className="text-right p-2">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => {
                const firstLine = order.lines[0];
                const pickup = formatPickupDateTimeParts(order.pickupStartsAt);
                const printedSummary = printedSummariesByOrderId.get(
                  order.crmOrderId,
                );
                return (
                  <tr
                    key={order.crmOrderId}
                    onPointerDown={() => onSelect(order)}
                    className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 active:bg-blue-50"
                  >
                    <td className="px-2 py-1.5 font-mono text-xs">
                      {printedSummary && (
                        <span className="mr-1 font-black text-red-600">
                          [P]
                        </span>
                      )}
                      {order.documentId}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={order.status} />
                      </div>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-[18px] font-semibold leading-none text-gray-900">
                      {pickup.date}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-[18px] font-semibold leading-none text-gray-900">
                      {pickup.day}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-[18px] font-semibold leading-none text-gray-900">
                      {pickup.time}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="truncate">{order.memberName}</div>
                    </td>
                    <td className="px-2 py-1.5 min-w-0">
                      {firstLine ? (
                        <div className="min-w-0">
                          <div className="font-medium leading-tight truncate">
                            {firstLine.name_ko}
                          </div>
                          <div className="text-xs leading-tight text-gray-500 truncate">
                            {firstLine.name_en}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap font-mono text-xs font-semibold text-gray-600">
                      {formatPickupCreatedAt(order.crmCreatedAt)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold">
                      {formatPickupMoney(order.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="h-12 border-t border-gray-200 flex items-center justify-center gap-4">
        <button
          type="button"
          disabled={loading || !paging?.hasPrev}
          onPointerDown={() => paging && fetchPage(paging.currentPage - 1)}
          className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
        >
          Prev
        </button>
        <span className="text-sm text-gray-500">
          {paging ? `${paging.currentPage} / ${paging.totalPages}` : "- / -"}
        </span>
        <button
          type="button"
          disabled={loading || !paging?.hasNext}
          onPointerDown={() => paging && fetchPage(paging.currentPage + 1)}
          className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
        >
          Next
        </button>
      </div>

      <MemberSearchModal
        open={memberModalOpen}
        onClose={() => setMemberModalOpen(false)}
        onSelect={(m) => {
          setMember(m);
          setMemberModalOpen(false);
        }}
      />
    </div>
  );
  },
);

export default PickupOrderSearchPanel;

function statusLabelForFilter(status: PickupOrderStatusFilter): string {
  return status === "ALL" ? "ALL" : statusLabel(status);
}

function StatusBadge({ status }: { status: PickupOrderStatus }) {
  return (
    <span
      className={cn(
        "text-[10px] font-bold px-1.5 py-1 rounded tracking-wide whitespace-nowrap",
        statusClass(status),
      )}
    >
      {statusLabel(status).split(" ")[0]}
    </span>
  );
}

function statusClass(status: PickupOrderStatus): string {
  switch (status) {
    case "PENDING":
      return "bg-gray-100 text-gray-700";
    case "ORDER_CONFIRMED":
      return "bg-blue-100 text-blue-700";
    case "READY":
      return "bg-emerald-100 text-emerald-700";
    case "COMPLETED":
      return "bg-slate-100 text-slate-700";
    case "CANCELLED_BY_STORE":
    case "CANCELLED_BY_CUSTOMER":
      return "bg-red-100 text-red-700";
  }
}

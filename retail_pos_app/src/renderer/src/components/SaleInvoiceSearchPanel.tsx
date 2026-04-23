// SaleInvoiceSearchPanel — invoice 검색 filter + list + pagination + QR 스캔
// 을 하나의 self-contained 컴포넌트로 묶은 것.
//
// 재사용처:
//  - SaleInvoiceSearchScreen → viewer modal 팝업 (onSelect 에 setViewerId)
//  - SaleRefundPickerScreen  → detail 화면으로 navigate (onSelect 에 navigate)
//
// Props:
//  - onSelect(inv)       row 클릭 / QR 스캔 단일결과 자동 선택 시 호출
//  - lockedTypeFilter?   refund picker 처럼 type 을 SALE 로 고정해야 할 때
//  - emptyLabel?         결과 없을 때 안내 문구

import { useCallback, useEffect, useState } from "react";
import type { Dayjs } from "dayjs";
import KeyboardInputText from "./KeyboardInputText";
import DateRangeSelector from "./DateRangeSelector";
import MemberSearchModal from "./MemberSearchModal";
import MoneyNumpad from "./Numpads/MoneyNumpad";
import LoadingOverlay from "./LoadingOverlay";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { Member } from "../types/models";
import {
  InvoiceTypeWire,
  SaleInvoiceListItem,
  SaleSearchParams,
  searchSaleInvoices,
} from "../service/sale.service";
import { PagingType } from "../libs/api";
import { MONEY_DP, MONEY_SCALE } from "../libs/constants";
import { cn } from "../libs/cn";

type TypeFilter = "ALL" | InvoiceTypeWire;
const ALL_TYPE_FILTERS: TypeFilter[] = ["ALL", "SALE", "REFUND", "SPEND"];
const PAGE_SIZE = 20;

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

// 영수증 QR payload prefix — sale-invoice-receipt.ts 의 `receipt%%%<serial>` 와 일치.
const QR_PREFIX = "receipt%%%";

interface Props {
  onSelect: (inv: SaleInvoiceListItem) => void;
  // 지정 시 type 토글 감춤 + 항상 해당 type 으로 검색.
  lockedTypeFilter?: InvoiceTypeWire;
  emptyLabel?: string;
}

export default function SaleInvoiceSearchPanel({
  onSelect,
  lockedTypeFilter,
  emptyLabel,
}: Props) {
  // ── Filter state ────────────────────────────────────────
  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState<Dayjs | null>(null);
  const [to, setTo] = useState<Dayjs | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [minTotalStr, setMinTotalStr] = useState(""); // cents string
  const [maxTotalStr, setMaxTotalStr] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(
    lockedTypeFilter ?? "ALL",
  );

  // ── Result state ────────────────────────────────────────
  const [items, setItems] = useState<SaleInvoiceListItem[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPage = useCallback(
    async (page: number) => {
      setLoading(true);
      try {
        const effectiveType = lockedTypeFilter ?? typeFilter;
        const params: SaleSearchParams = {
          page,
          limit: PAGE_SIZE,
          keyword: keyword.trim() || undefined,
          from: from?.toISOString(),
          to: to?.toISOString(),
          memberId: member?.id,
          minTotal: minTotalStr ? parseInt(minTotalStr, 10) : undefined,
          maxTotal: maxTotalStr ? parseInt(maxTotalStr, 10) : undefined,
          type: effectiveType === "ALL" ? undefined : effectiveType,
        };
        const res = await searchSaleInvoices(params);
        if (res.ok && res.result) {
          setItems(res.result);
          setPaging(res.paging);
        } else {
          setItems([]);
          setPaging(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [
      keyword,
      from,
      to,
      member,
      minTotalStr,
      maxTotalStr,
      typeFilter,
      lockedTypeFilter,
    ],
  );

  function handleSearch() {
    fetchPage(1);
  }

  function reset() {
    setKeyword("");
    setFrom(null);
    setTo(null);
    setMember(null);
    setMinTotalStr("");
    setMaxTotalStr("");
    if (!lockedTypeFilter) setTypeFilter("ALL");
  }

  // Initial fetch — unfiltered list (type lock 고려됨).
  useEffect(() => {
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // QR 스캔 → 해당 serial 로 즉시 검색. 기존 filter 는 리셋. 결과 1건이면
  // onSelect 호출로 parent 가 알아서 (viewer open / navigate 등) 처리.
  const handleScan = useCallback(
    async (barcode: string) => {
      const serial = barcode.startsWith(QR_PREFIX)
        ? barcode.slice(QR_PREFIX.length)
        : barcode;
      setKeyword(serial);
      setFrom(null);
      setTo(null);
      setMember(null);
      setMinTotalStr("");
      setMaxTotalStr("");
      if (!lockedTypeFilter) setTypeFilter("ALL");
      setLoading(true);
      try {
        const res = await searchSaleInvoices({
          page: 1,
          limit: PAGE_SIZE,
          keyword: serial,
          type: lockedTypeFilter,
        });
        if (res.ok && res.result) {
          setItems(res.result);
          setPaging(res.paging);
          if (res.result.length === 1) onSelect(res.result[0]);
        } else {
          setItems([]);
          setPaging(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [lockedTypeFilter, onSelect],
  );
  useBarcodeScanner(handleScan);

  return (
    <div className="flex flex-col h-full relative">
      {loading && <LoadingOverlay label="Searching..." />}

      {/* Filter bar */}
      <div className="p-3 border-b border-gray-200 flex flex-wrap items-center gap-2">
        <KeyboardInputText
          value={keyword}
          onChange={setKeyword}
          onEnter={handleSearch}
          placeholder="Keyword (serial / item / member)"
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

        {/* Member filter */}
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
              <span className="text-gray-400">✕</span>
            </>
          ) : (
            <span className="text-gray-400">Any member</span>
          )}
        </div>

        <MoneyFilterInput
          label="Min $"
          value={minTotalStr}
          setValue={setMinTotalStr}
        />
        <MoneyFilterInput
          label="Max $"
          value={maxTotalStr}
          setValue={setMaxTotalStr}
        />

        {/* Type toggle group — locked 일 땐 감춤 */}
        {!lockedTypeFilter && (
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {ALL_TYPE_FILTERS.map((t) => (
              <button
                key={t}
                type="button"
                onPointerDown={() => setTypeFilter(t)}
                className={cn(
                  "px-3 h-9 text-xs font-medium border-r last:border-r-0 border-gray-300",
                  typeFilter === t
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 active:bg-gray-100",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}

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
          onPointerDown={handleSearch}
          disabled={loading}
          className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-bold active:bg-blue-700 disabled:opacity-40"
        >
          Search
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {items.length === 0 && !loading ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            {emptyLabel ?? "No invoices"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr className="border-b border-gray-200">
                {!lockedTypeFilter && (
                  <th className="text-left p-2 w-20">Type</th>
                )}
                <th className="text-left p-2">Serial</th>
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Member</th>
                <th className="text-right p-2">Total</th>
                <th className="text-left p-2">Terminal / Cashier</th>
              </tr>
            </thead>
            <tbody>
              {items.map((inv) => (
                <tr
                  key={inv.id}
                  onPointerDown={() => onSelect(inv)}
                  className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 active:bg-blue-50"
                >
                  {!lockedTypeFilter && (
                    <td className="p-2">
                      <TypeBadge type={inv.type} />
                    </td>
                  )}
                  <td className="p-2 font-mono text-xs">
                    {inv.serial ?? `#${inv.id}`}
                  </td>
                  <td className="p-2 text-xs text-gray-500">
                    {new Date(inv.createdAt).toLocaleString()}
                  </td>
                  <td className="p-2">
                    {inv.memberName ?? (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="p-2 text-right font-mono">
                    ${fmtMoney(inv.total)}
                  </td>
                  <td className="p-2 text-xs text-gray-500">
                    {inv.terminalName ?? "—"} / {inv.userName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="h-12 border-t border-gray-200 flex items-center justify-center gap-4">
        <button
          type="button"
          disabled={!paging?.hasPrev}
          onPointerDown={() => paging && fetchPage(paging.currentPage - 1)}
          className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
        >
          ← Prev
        </button>
        <span className="text-sm text-gray-500">
          {paging ? `${paging.currentPage} / ${paging.totalPages}` : "— / —"}
        </span>
        <button
          type="button"
          disabled={!paging?.hasNext}
          onPointerDown={() => paging && fetchPage(paging.currentPage + 1)}
          className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
        >
          Next →
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
}

// ── Type badge ───────────────────────────────────────────────
function TypeBadge({ type }: { type: InvoiceTypeWire }) {
  const cls =
    type === "SALE"
      ? "bg-emerald-100 text-emerald-700"
      : type === "REFUND"
        ? "bg-amber-100 text-amber-700"
        : "bg-blue-100 text-blue-700";
  return (
    <span
      className={cn(
        "text-[10px] font-bold px-2 py-1 rounded tracking-wider",
        cls,
      )}
    >
      {type}
    </span>
  );
}

// ── Money filter (Min/Max) ───────────────────────────────────
// Cents string state. 빈 string → 필터 미적용.
function MoneyFilterInput({
  label,
  value,
  setValue,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const cents = parseInt(value || "0", 10);
  const display = value ? `$${(cents / 100).toFixed(2)}` : label;

  return (
    <>
      <div
        onPointerDown={() => setOpen(true)}
        className="h-9 px-3 rounded-lg border border-gray-300 text-sm flex items-center cursor-pointer gap-2"
      >
        <span className={value ? "text-gray-800" : "text-gray-400"}>
          {display}
        </span>
        {value && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              setValue("");
            }}
            className="text-gray-400"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center"
          style={{ zIndex: 1000 }}
          onPointerDown={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 min-w-sm"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">
              {label}
            </div>
            <MoneyNumpad val={value} setVal={setValue} />
            <button
              type="button"
              onPointerDown={() => setOpen(false)}
              className="mt-3 w-full h-10 rounded-lg bg-blue-600 text-white font-bold text-sm active:bg-blue-700"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}

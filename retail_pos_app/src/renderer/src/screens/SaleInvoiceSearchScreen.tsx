import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Dayjs } from "dayjs";
import KeyboardInputText from "../components/KeyboardInputText";
import DateRangeSelector from "../components/DateRangeSelector";
import MemberSearchModal from "../components/MemberSearchModal";
import MoneyNumpad from "../components/Numpads/MoneyNumpad";
import LoadingOverlay from "../components/LoadingOverlay";
import SaleInvoiceViewer from "../components/SaleInvoiceViewer";
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
const TYPE_FILTERS: TypeFilter[] = ["ALL", "SALE", "REFUND", "SPEND"];
const PAGE_SIZE = 20;

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

// 영수증 QR payload prefix — sale-invoice-receipt.ts 의 `receipt%%%<serial>` 와 일치.
const QR_PREFIX = "receipt%%%";

export default function SaleInvoiceSearchScreen() {
  const navigate = useNavigate();

  // ── Filter state ────────────────────────────────────────
  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState<Dayjs | null>(null);
  const [to, setTo] = useState<Dayjs | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [minTotalStr, setMinTotalStr] = useState(""); // cents string
  const [maxTotalStr, setMaxTotalStr] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");

  // ── Result state ────────────────────────────────────────
  const [items, setItems] = useState<SaleInvoiceListItem[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [loading, setLoading] = useState(false);

  // Viewer modal — row click 시 해당 invoice id 설정.
  const [viewerId, setViewerId] = useState<number | null>(null);

  const fetchPage = useCallback(
    async (page: number) => {
      setLoading(true);
      try {
        const params: SaleSearchParams = {
          page,
          limit: PAGE_SIZE,
          keyword: keyword.trim() || undefined,
          from: from?.toISOString(),
          to: to?.toISOString(),
          memberId: member?.id,
          minTotal: minTotalStr ? parseInt(minTotalStr, 10) : undefined,
          maxTotal: maxTotalStr ? parseInt(maxTotalStr, 10) : undefined,
          type: typeFilter === "ALL" ? undefined : typeFilter,
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
    [keyword, from, to, member, minTotalStr, maxTotalStr, typeFilter],
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
    setTypeFilter("ALL");
  }

  // Initial fetch — unfiltered list.
  useEffect(() => {
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // QR 스캔 → 해당 serial 로 즉시 검색. 기존 filter 는 리셋 (cashier 가 영수증
  // 들고 스캔 = "이 특정 invoice 찾기" 의도). 결과가 1건이면 viewer 자동 open.
  // 바코드 payload format: `receipt%%%<serial>` (sale-invoice-receipt.ts QR).
  //   일반 스캔도 허용 — prefix 없으면 입력 그대로 keyword 로 사용.
  const handleScan = useCallback(async (barcode: string) => {
    const serial = barcode.startsWith(QR_PREFIX)
      ? barcode.slice(QR_PREFIX.length)
      : barcode;
    setKeyword(serial);
    setFrom(null);
    setTo(null);
    setMember(null);
    setMinTotalStr("");
    setMaxTotalStr("");
    setTypeFilter("ALL");
    setLoading(true);
    try {
      const res = await searchSaleInvoices({
        page: 1,
        limit: PAGE_SIZE,
        keyword: serial,
      });
      if (res.ok && res.result) {
        setItems(res.result);
        setPaging(res.paging);
        if (res.result.length === 1) setViewerId(res.result[0].id);
      } else {
        setItems([]);
        setPaging(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useBarcodeScanner(handleScan);

  return (
    <div className="flex flex-col h-full bg-white">
      {loading && <LoadingOverlay label="Searching..." />}

      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-4 border-b border-gray-200">
        <button
          type="button"
          onPointerDown={() => navigate("/")}
          className="px-4 py-2 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold">Invoices</h1>
      </div>

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

        {/* Type toggle group */}
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {TYPE_FILTERS.map((t) => (
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
            No invoices
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr className="border-b border-gray-200">
                <th className="text-left p-2 w-20">Type</th>
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
                  onPointerDown={() => setViewerId(inv.id)}
                  className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 active:bg-blue-50"
                >
                  <td className="p-2">
                    <TypeBadge type={inv.type} />
                  </td>
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

      <SaleInvoiceViewer
        invoiceId={viewerId}
        onClose={() => setViewerId(null)}
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

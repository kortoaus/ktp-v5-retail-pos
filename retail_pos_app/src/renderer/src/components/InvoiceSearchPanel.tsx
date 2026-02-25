import { useState } from "react";
import type { Dayjs } from "dayjs";
import { getSaleInvoices, getSaleInvoiceWithChildren } from "../service/sale.service";
import { printSaleInvoiceReceipt, renderReceipt } from "../libs/printer/sale-invoice-receipt";
import { printRefundReceipt, renderRefundReceipt } from "../libs/printer/refund-receipt";
import { buildPrintBufferNoCut, cutCommand } from "../libs/printer/escpos";
import { printESCPOS } from "../libs/printer/print.service";
import { Member, SaleInvoice } from "../types/models";
import { PagingType } from "../libs/api";
import { cn } from "../libs/cn";
import dayjsAU from "../libs/dayjsAU";
import { FaArrowUp, FaArrowDown } from "react-icons/fa6";
import InvoiceReceiptViewer from "../screens/SaleInvoiceSearchScreen/InvoiceReceiptViewer";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import KeyboardInputText from "./KeyboardInputText";
import DateRangeSelector from "./DateRangeSelector";
import MemberSearchModal from "./MemberSearchModal";

const PAGE_SIZE = 10;
const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`;

interface InvoiceSearchPanelProps {
  headerLeft: React.ReactNode;
  onSelect?: (invoice: SaleInvoice) => void;
  scanEnabled?: boolean;
}

export default function InvoiceSearchPanel({
  headerLeft,
  onSelect,
  scanEnabled = true,
}: InvoiceSearchPanelProps) {
  const [invoices, setInvoices] = useState<SaleInvoice[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState<Dayjs | null>(
    dayjsAU().subtract(1, "year").startOf("day"),
  );
  const [dateTo, setDateTo] = useState<Dayjs | null>(dayjsAU().endOf("day"));

  const [member, setMember] = useState<Member | null>(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const selected = invoices.find((inv) => inv.id === selectedId) ?? null;

  useBarcodeScanner((scanned) => {
    if (!scanEnabled) return;
    if (scanned.split("-").length !== 4) return;
    setKeyword(scanned);
    setPage(1);
    getSaleInvoices({
      keyword: scanned,
      page: 1,
      limit: PAGE_SIZE,
      from: dateFrom?.valueOf(),
      to: dateTo?.valueOf(),
      memberId: member ? member.id : undefined,
    }).then((res) => {
      if (res.ok && res.result) {
        setInvoices(res.result);
        setPaging(res.paging);
        if (res.result.length === 1) setSelectedId(res.result[0].id);
      }
    });
  });

  async function fetchInvoices(p: number) {
    try {
      const res = await getSaleInvoices({
        keyword: keyword || undefined,
        page: p,
        limit: PAGE_SIZE,
        from: dateFrom?.valueOf(),
        to: dateTo?.valueOf(),
        memberId: member ? member.id : undefined,
      });
      if (res.ok && res.result) {
        setInvoices(res.result);
        setPaging(res.paging);
      }
    } catch {
      // noop
    }
  }

  function handleSearch() {
    setPage(1);
    fetchInvoices(1);
  }

  function handlePrev() {
    if (!paging?.hasPrev) return;
    const p = page - 1;
    setPage(p);
    fetchInvoices(p);
  }

  function handleNext() {
    if (!paging?.hasNext) return;
    const p = page + 1;
    setPage(p);
    fetchInvoices(p);
  }

  function handleRowSelect(id: number) {
    setSelectedId(id === selectedId ? null : id);
  }

  async function handlePrint() {
    if (!selected) return;

    if (selected.type === "refund") {
      await printRefundReceipt(selected);
      return;
    }

    // Sale invoice: fetch with children, print all with single cut
    const { ok, result } = await getSaleInvoiceWithChildren(selected.id);
    if (!ok || !result) {
      await printSaleInvoiceReceipt(selected, true);
      return;
    }

    const buffers: Uint8Array[] = [];

    // Sale receipt
    const saleCanvas = await renderReceipt(result.invoice, true);
    buffers.push(buildPrintBufferNoCut(saleCanvas));

    // Refund receipts
    for (const refund of result.refundInvoices) {
      const refundCanvas = await renderRefundReceipt(refund);
      buffers.push(buildPrintBufferNoCut(refundCanvas));
    }

    // Single cut at the end
    buffers.push(cutCommand());

    const combined = Uint8Array.from(
      buffers.reduce<number[]>((acc, b) => [...acc, ...b], []),
    );
    await printESCPOS(combined);
  }

  return (
    <>
      <div className="h-full flex">
        <div className="flex-1 flex flex-col border-r border-gray-200">
          <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              {headerLeft}
              <h2 className="text-lg font-bold">Invoices</h2>
            </div>
            {paging && (
              <span className="text-xs text-gray-400">
                {paging.currentPage} / {paging.totalPages}
              </span>
            )}
          </div>

          <div className="p-3 border-b border-gray-200 flex gap-2 items-end">
            <button
              type="button"
              onPointerDown={() => {
                if (member) {
                  setMember(null);
                } else {
                  setMemberModalOpen(true);
                }
              }}
              className={cn(
                "h-9 px-3 rounded-lg text-sm font-medium shrink-0",
                member
                  ? "bg-blue-600 text-white active:bg-blue-700"
                  : "bg-gray-100 text-gray-600 active:bg-gray-200",
              )}
            >
              {member ? `${member.name} ✕` : "Member"}
            </button>
            <KeyboardInputText
              value={keyword}
              onChange={setKeyword}
              onEnter={handleSearch}
              placeholder="Search keyword..."
              className="flex-1"
            />
            <DateRangeSelector
              from={dateFrom}
              to={dateTo}
              setVal={(f, t) => {
                setDateFrom(f);
                setDateTo(t);
              }}
              className="w-52"
            />
            <button
              onPointerDown={handleSearch}
              className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 transition-colors shrink-0"
            >
              Search
            </button>
          </div>

          <div className="text-xs bg-gray-100 border-b border-gray-200 h-8 flex items-center divide-x divide-gray-200 *:flex *:justify-center *:items-center *:h-full">
            <div className="w-12">No.</div>
            <div className="w-16">Type</div>
            <div className="flex-1">Invoice</div>
            <div className="w-40">Date</div>
            <div className="w-28">Terminal</div>
            <div className="w-28">Total</div>
          </div>

          <div
            className="flex-1 overflow-hidden divide-y divide-gray-200"
            style={{
              display: "grid",
              gridTemplateRows: `repeat(${PAGE_SIZE}, 1fr)`,
            }}
          >
            {Array.from({ length: PAGE_SIZE }).map((_, i) => {
              const inv = invoices[i];
              const isSelected = inv && selectedId === inv.id;
              return (
                <div key={i}>
                  {inv && (
                    <div
                      onPointerDown={() => handleRowSelect(inv.id)}
                      className={cn(
                        "flex h-full divide-x divide-gray-200 cursor-pointer",
                        isSelected && "bg-blue-50",
                      )}
                    >
                      <div className="w-12 flex items-center justify-center text-sm text-gray-400">
                        {(page - 1) * PAGE_SIZE + i + 1}
                      </div>
                      <div className={cn(
                        "w-16 flex items-center justify-center text-[10px] font-bold uppercase",
                        inv.type === "refund" ? "text-red-600" : "text-blue-600",
                      )}>
                        {inv.type}
                      </div>
                      <div className="flex-1 p-1 flex flex-col justify-center min-w-0">
                        <div className="text-sm font-medium truncate">
                          {inv.serialNumber ?? `#${inv.id}`}
                        </div>
                      </div>
                      <div className="w-40 flex items-center justify-center text-xs text-gray-500">
                        {dayjsAU(inv.issuedAt).format("DD/MM/YY hh:mm A")}
                      </div>
                      <div className="w-28 flex items-center justify-center text-xs">
                        {inv.terminal.name}
                      </div>
                      <div className={cn(
                        "w-28 flex items-center justify-end pr-2 text-sm font-bold font-mono",
                        inv.type === "refund" && "text-red-600",
                      )}>
                        {inv.type === "refund" ? "-" : ""}{fmt(inv.total)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-[64px] h-full grid grid-rows-2 divide-y divide-gray-200">
          <div
            onPointerDown={handlePrev}
            className={cn(
              "flex items-center justify-center bg-slate-500 text-white text-xl",
              !paging?.hasPrev && "opacity-50",
            )}
          >
            <FaArrowUp />
          </div>
          <div
            onPointerDown={handleNext}
            className={cn(
              "flex items-center justify-center bg-slate-500 text-white text-xl",
              !paging?.hasNext && "opacity-50",
            )}
          >
            <FaArrowDown />
          </div>
        </div>

        <div className="w-[500px] flex flex-col overflow-hidden border-l border-gray-200">
          {selected ? (
            <>
              <div className="h-12 flex items-center justify-end gap-2 px-4 border-b border-gray-200">
                <button
                  onPointerDown={handlePrint}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white active:bg-blue-700 transition-colors"
                >
                  Print
                </button>
                {onSelect && (
                  <button
                    onPointerDown={() => onSelect(selected)}
                    className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white active:bg-green-700 transition-colors"
                  >
                    Select
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto bg-gray-50">
                <InvoiceReceiptViewer invoice={selected} />
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              Select an invoice
            </div>
          )}
        </div>
      </div>
      <MemberSearchModal
        open={memberModalOpen}
        onClose={() => setMemberModalOpen(false)}
        onSelect={(m) => {
          setMember(m);
          setMemberModalOpen(false);
        }}
      />
    </>
  );
}

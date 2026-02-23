import { useState } from "react";
import { getSaleInvoices } from "../../service/sale.service";
import { printSaleInvoiceReceipt } from "../../libs/printer/sale-invoice-receipt";
import { SaleInvoice } from "../../types/models";
import { PagingType } from "../../libs/api";
import { cn } from "../../libs/cn";
import dayjsAU from "../../libs/dayjsAU";
import { FaArrowUp, FaArrowDown } from "react-icons/fa6";
import { Link } from "react-router-dom";
import InvoiceReceiptViewer from "./InvoiceReceiptViewer";
import { useBarcodeScanner } from "../../hooks/useBarcodeScanner";

const PAGE_SIZE = 10;
const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`;

export default function SaleInvoiceSearchScreen() {
  const [invoices, setInvoices] = useState<SaleInvoice[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState(
    dayjsAU().startOf("day").format("YYYY-MM-DD"),
  );
  const [dateTo, setDateTo] = useState(
    dayjsAU().startOf("day").format("YYYY-MM-DD"),
  );

  const selected = invoices.find((inv) => inv.id === selectedId) ?? null;

  useBarcodeScanner((scanned) => {
    if (scanned.split("-").length === 4) {
      const yearStart = dayjsAU().startOf("year").format("YYYY-MM-DD");
      const yearEnd = dayjsAU().endOf("year").format("YYYY-MM-DD");
      setKeyword(scanned);
      setDateFrom(yearStart);
      setDateTo(yearEnd);
      setPage(1);
      const from = dayjsAU(yearStart).startOf("day").valueOf();
      const to = dayjsAU(yearEnd).endOf("day").valueOf();
      getSaleInvoices({ keyword: scanned, page: 1, limit: PAGE_SIZE, from, to }).then((res) => {
        if (res.ok && res.result) {
          setInvoices(res.result);
          setPaging(res.paging);
          if (res.result.length === 1) setSelectedId(res.result[0].id);
        }
      });
    }
  });

  async function fetchInvoices(p: number) {
    try {
      const from = dayjsAU(dateFrom).startOf("day").valueOf();
      const to = dayjsAU(dateTo).endOf("day").valueOf();
      const res = await getSaleInvoices({
        keyword: keyword || undefined,
        page: p,
        limit: PAGE_SIZE,
        from,
        to,
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

  function handleSelect(id: number) {
    setSelectedId(id === selectedId ? null : id);
  }

  async function handlePrint() {
    if (!selected) return;
    await printSaleInvoiceReceipt(selected, true);
  }

  return (
    <div className="h-full flex">
      <div className="flex-1 flex flex-col border-r border-gray-200">
        <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              &larr; Back
            </Link>
            <h2 className="text-lg font-bold">Invoices</h2>
          </div>
          {paging && (
            <span className="text-xs text-gray-400">
              {paging.currentPage} / {paging.totalPages}
            </span>
          )}
        </div>

        <div className="p-3 border-b border-gray-200 flex gap-2 items-end">
          <input
            type="text"
            placeholder="Search keyword..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1 h-9 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36 h-9 px-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36 h-9 px-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    onPointerDown={() => handleSelect(inv.id)}
                    className={cn(
                      "flex h-full divide-x divide-gray-200 cursor-pointer",
                      isSelected && "bg-blue-50",
                    )}
                  >
                    <div className="w-12 flex items-center justify-center text-sm text-gray-400">
                      {(page - 1) * PAGE_SIZE + i + 1}
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
                    <div className="w-28 flex items-center justify-end pr-2 text-sm font-bold font-mono">
                      {fmt(inv.total)}
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
            <div className="h-12 flex items-center justify-end px-4 border-b border-gray-200">
              <button
                onPointerDown={handlePrint}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white active:bg-blue-700 transition-colors"
              >
                Print
              </button>
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
  );
}

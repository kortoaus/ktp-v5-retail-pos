import React, { useMemo, useState } from "react";
import { cn } from "../../libs/cn";
import { MONEY_DP } from "../../libs/constants";
import {
  FaArrowsDownToLine,
  FaArrowDown,
  FaArrowUp,
  FaArrowsUpToLine,
} from "react-icons/fa6";
import { RefundSaleInvoiceRow } from ".";

const PAGE_SIZE = 10;
const fmt = (n: number) => `$${Math.abs(n).toFixed(MONEY_DP)}`;

export default function SaleInvoiceRowsViewer({
  rows,
  onSelect,
}: {
  rows: RefundSaleInvoiceRow[];
  onSelect: (row: RefundSaleInvoiceRow) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const maxOffset = Math.max(0, rows.length - PAGE_SIZE);
  const visibleRows = useMemo(
    () => rows.slice(offset, offset + PAGE_SIZE),
    [rows, offset],
  );

  function handleRowClick(row: RefundSaleInvoiceRow) {
    setSelectedId(row.id === selectedId ? null : row.id);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="text-xs bg-gray-100 border-b border-gray-200 h-8 flex items-center divide-x divide-gray-200 *:flex *:justify-center *:items-center *:h-full">
        <div className="w-10">No.</div>
        <div className="flex-1">Item</div>
      </div>

      <div
        className="flex-1 overflow-hidden divide-y divide-gray-200"
        style={{
          display: "grid",
          gridTemplateRows: `repeat(${PAGE_SIZE}, 1fr)`,
        }}
      >
        {Array.from({ length: PAGE_SIZE }).map((_, i) => {
          const row = visibleRows[i];
          const isSelected = row && selectedId === row.id;
          return (
            <div key={i}>
              {row && (
                <RowCaption
                  row={row}
                  index={i}
                  onClick={() => handleRowClick(row)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="h-12 grid grid-cols-4 divide-x divide-gray-200 border-t border-gray-200">
        <PagingButton
          icon={<FaArrowsUpToLine />}
          disabled={offset <= 0}
          onPress={() => setOffset(0)}
        />
        <PagingButton
          icon={<FaArrowUp />}
          disabled={offset <= 0}
          onPress={() => setOffset(Math.max(0, offset - 1))}
        />
        <PagingButton
          icon={<FaArrowDown />}
          disabled={offset >= maxOffset}
          onPress={() => setOffset(Math.min(maxOffset, offset + 1))}
        />
        <PagingButton
          icon={<FaArrowsDownToLine />}
          disabled={offset >= maxOffset}
          onPress={() => setOffset(maxOffset)}
        />
      </div>
    </div>
  );
}

function RowCaption({
  row,
  index,
  onClick,
}: {
  row: RefundSaleInvoiceRow;
  index: number;
  onClick: () => void;
}) {
  const {
    name_en,
    name_ko,
    barcode,
    qty,
    unit_price_original,
    unit_price_adjusted,
    unit_price_discounted,
    unit_price_effective,
  } = row;
  return (
    <div
      onPointerDown={() => onClick()}
      className={cn(
        "flex h-full divide-x divide-gray-200 cursor-pointer",
        row.refunded && "opacity-40",
      )}
    >
      <div className="w-10 center text-xs">{index}</div>
      <div className="flex-1">
        <div className="text-xs">{row.name_en}</div>
        <div>{JSON.stringify(qty)}</div>
      </div>
    </div>
  );
}

function PagingButton({
  icon,
  disabled,
  onPress,
}: {
  icon: React.ReactNode;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <div
      onPointerDown={disabled ? undefined : onPress}
      className={cn(
        "flex items-center justify-center bg-slate-500 text-white text-lg",
        disabled && "opacity-50",
      )}
    >
      {icon}
    </div>
  );
}

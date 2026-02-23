import { useMemo } from "react";
import { LINE_PAGE_SIZE, useSalesStore } from "../../store/salesStore";
import { cn } from "../../libs/cn";
import { SaleLineType } from "../../types/sales";
import { MONEY_DP, QTY_DP } from "../../libs/constants";

export default function SaleScreenLineViewer({
  lines,
  lineOffset,
  maxOffset,
  setSelectedLineKey,
  selectedLineKey,
}: {
  lineOffset: number;
  maxOffset: number;
  lines: SaleLineType[];
  setSelectedLineKey: (lineKey: string | null) => void;
  selectedLineKey: string | null;
}) {
  const visibleLines = useMemo(
    () => lines.slice(lineOffset, lineOffset + LINE_PAGE_SIZE),
    [lines, lineOffset],
  );

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <div className="text-sm bg-gray-100 border-b border-b-gray-200 h-8 divide-x divide-gray-200 flex *:flex *:justify-center *:items-center">
        <div className="w-12">No.</div>
        <div className="flex-1">Item</div>
        <div className="w-28">Unit Price</div>
        <div className="w-24">Qty</div>
        <div className="w-24">Total</div>
      </div>
      {/* Lines */}
      <div
        className="flex-1 h-full overflow-hidden divide-y divide-gray-200"
        style={{
          display: "grid",
          gridTemplateRows: `repeat(${LINE_PAGE_SIZE}, 1fr)`,
        }}
      >
        {Array.from({ length: LINE_PAGE_SIZE }).map((_, index) => {
          const line = visibleLines[index];

          const isSelected = line && selectedLineKey === line.lineKey;

          return (
            <div className="" key={index}>
              {line && (
                <LineCaption
                  line={line}
                  onClick={() => {
                    if (isSelected) {
                      setSelectedLineKey(null);
                    } else {
                      setSelectedLineKey(line.lineKey);
                    }
                  }}
                  isSelected={isSelected}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineCaption({
  line,
  isSelected,
  onClick,
}: {
  line: SaleLineType;
  onClick: () => void;
  isSelected: boolean;
}) {
  const {
    index,
    name_en,
    name_ko,
    barcode,
    total,
    qty,
    unit_price_original,
    unit_price_effective,
    unit_price_adjusted,
    type,
    measured_weight,
    uom,
    taxable,
  } = line;

  const priceNotMatched = unit_price_original !== unit_price_effective;

  let displayQty = qty;
  if (type === "weight-prepacked") {
    displayQty = 1;
  }

  let displayPrice = unit_price_effective;
  if (type === "weight-prepacked") {
    displayPrice = total;
  }

  return (
    <div
      onClick={onClick}
      key={line.lineKey}
      className={cn(
        "flex h-full divide-x divide-gray-200",
        isSelected && "bg-blue-50",
      )}
    >
      <div className="w-12 flex items-center justify-center">{index + 1}</div>

      {/* Names */}
      <div className="flex-1 p-1 flex flex-col justify-center">
        <div className="line-clamp-1 truncate text-base font-medium">
          {name_en}
        </div>
        <div className="line-clamp-1 truncate text-gray-500 text-sm">
          {name_ko}
        </div>
      </div>

      {/* Unit Price */}
      <div className="flex flex-col items-end justify-center w-28 p-1">
        <div className="text-lg font-medium">
          {unit_price_adjusted && <span className="text-red-500">*</span>}
          {displayPrice.toFixed(MONEY_DP)}
        </div>
        {priceNotMatched && (
          <div className="text-red-500 text-sm line-through">
            {unit_price_original.toFixed(MONEY_DP)}
          </div>
        )}
      </div>

      {/* Qty */}
      <div className="flex flex-col items-end justify-center w-24  p-1">
        <div className="text-lg font-medium">{displayQty.toFixed(QTY_DP)}</div>
      </div>

      {/* Total */}
      <div className="flex flex-col items-end justify-center w-24  p-1">
        <div className="text-lg font-medium">
          {taxable && <span className="text-red-500">*</span>}
          {total.toFixed(MONEY_DP)}
        </div>
      </div>
    </div>
  );
}

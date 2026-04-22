import { useMemo } from "react";
import { cn } from "../../libs/cn";
import { SaleLineType } from "../../types/sales";
import { MONEY_DP, MONEY_SCALE, QTY_DP, QTY_SCALE } from "../../libs/constants";
import { LINE_PAGE_SIZE } from "../../store/SalesStore";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);
const fmtQty = (q: number) => (q / QTY_SCALE).toFixed(QTY_DP);

export default function LineViewer({
  lines,
  lineOffset,
  selectedLineKey,
  setSelectedLineKey,
}: {
  lines: SaleLineType[];
  lineOffset: number;
  selectedLineKey: string | null;
  setSelectedLineKey: (lineKey: string | null) => void;
}) {
  const visibleLines = useMemo(
    () => lines.slice(lineOffset, lineOffset + LINE_PAGE_SIZE),
    [lines, lineOffset],
  );

  return (
    <div className="w-full h-full flex flex-col">
      <div className="text-sm bg-gray-100 border-b border-b-gray-200 h-8 divide-x divide-gray-200 flex *:flex *:justify-center *:items-center">
        <div className="w-12">No.</div>
        <div className="flex-1">Item</div>
        <div className="w-24">U. Price</div>
        <div className="w-24">Qty</div>
        <div className="w-24">Total</div>
      </div>
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
            <div key={index}>
              {line && (
                <LineCaption
                  line={line}
                  isSelected={isSelected}
                  onClick={() =>
                    setSelectedLineKey(isSelected ? null : line.lineKey)
                  }
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
    total,
    qty,
    unit_price_original,
    unit_price_effective,
    unit_price_adjusted,
    measured_weight,
    type,
    taxable,
  } = line;

  const priceNotMatched = unit_price_original !== unit_price_effective;

  const displayQty = qty;
  const displayPrice = unit_price_effective;

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex h-full divide-x divide-gray-200",
        isSelected && "bg-blue-50",
      )}
    >
      <div className="w-12 flex items-center justify-center">{index + 1}</div>

      <div className="flex-1 p-1 flex flex-col justify-center">
        <div className="line-clamp-1 truncate text-sm font-medium">
          {name_en}
        </div>
        <div className="line-clamp-1 truncate text-gray-500 text-xs">
          {name_ko}
        </div>
        {measured_weight != null && measured_weight > 0 && (
          <div className="text-xs text-gray-400">
            {fmtQty(measured_weight)}kg ×{" "}
            {fmtMoney(line.unit_price_discounted ?? unit_price_original)}/kg
          </div>
        )}
      </div>

      <div className="flex flex-col items-end justify-center w-24 p-1">
        <div className="text-base font-medium">
          {unit_price_adjusted && <span className="text-red-500">*</span>}
          {fmtMoney(displayPrice)}
        </div>
        {priceNotMatched && (
          <div className="text-red-500 text-sm line-through">
            {fmtMoney(unit_price_original)}
          </div>
        )}
      </div>

      <div className="flex flex-col items-end justify-center w-24 p-1">
        <div className="text-base font-medium">{fmtQty(displayQty)}</div>
      </div>

      <div className="flex flex-col items-end justify-center w-24 p-1">
        <div className="text-base font-medium">
          {taxable && <span className="text-red-500">*</span>}
          {fmtMoney(total)}
        </div>
      </div>
    </div>
  );
}

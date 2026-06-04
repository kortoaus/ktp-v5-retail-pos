import { useMemo } from "react";
import { cn } from "../../libs/cn";
import { SaleLineType } from "../../types/sales";
import { MONEY_DP, MONEY_SCALE, QTY_DP, QTY_SCALE } from "../../libs/constants";
import { LINE_PAGE_SIZE } from "../../store/SalesStore";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);
const fmtQty = (q: number) => (q / QTY_SCALE).toFixed(QTY_DP);

type LineViewerDisplayMode = "cashier" | "customer";

type LineViewerClassSet = {
  header: string;
  noColumn: string;
  unitPriceColumn: string;
  qtyColumn: string;
  totalColumn: string;
  discountColumn: string;
  lineRoot: string;
  itemCell: string;
  noText: string;
  nameKo: string;
  nameEn: string;
  weightText: string;
  moneyText: string;
  originalPriceText: string;
  qtyText: string;
  totalText: string;
  discountText: string;
};

const LINE_VIEWER_CLASSES: Record<LineViewerDisplayMode, LineViewerClassSet> = {
  cashier: {
    header:
      "text-sm bg-gray-100 border-b border-b-gray-200 h-8 divide-x divide-gray-200 flex *:flex *:justify-center *:items-center",
    noColumn: "w-8",
    unitPriceColumn: "w-20",
    qtyColumn: "w-20",
    totalColumn: "w-20",
    discountColumn: "w-14",
    lineRoot: "flex h-full divide-x divide-gray-200",
    itemCell: "flex-1 p-1 flex flex-col justify-center min-w-0",
    noText: "w-8 flex items-center justify-center text-xs",
    nameKo: "line-clamp-1 text-xs font-medium",
    nameEn: "line-clamp-1 text-gray-500 text-xs",
    weightText: "text-xs text-gray-400",
    moneyText: "text-sm font-medium",
    originalPriceText: "text-red-500 text-sm line-through",
    qtyText: "text-sm font-medium",
    totalText: "text-sm font-medium",
    discountText: "text-sm font-medium",
  },
  customer: {
    header:
      "text-base bg-gray-100 border-b border-b-gray-200 h-10 divide-x divide-gray-200 flex font-semibold *:flex *:justify-center *:items-center",
    noColumn: "w-12",
    unitPriceColumn: "w-28",
    qtyColumn: "w-28",
    totalColumn: "w-32",
    discountColumn: "w-16",
    lineRoot: "flex h-full divide-x divide-gray-200",
    itemCell: "flex-1 px-3 py-2 flex flex-col justify-center min-w-0",
    noText: "w-12 flex items-center justify-center text-lg font-semibold",
    nameKo: "line-clamp-1 text-xl font-semibold leading-tight",
    nameEn: "line-clamp-1 text-gray-500 text-base leading-tight",
    weightText: "text-sm text-gray-400 leading-tight",
    moneyText: "text-xl font-semibold",
    originalPriceText: "text-red-500 text-base line-through",
    qtyText: "text-xl font-semibold",
    totalText: "text-xl font-semibold",
    discountText: "text-lg font-semibold",
  },
};

export default function LineViewer({
  lines,
  lineOffset,
  selectedLineKey,
  setSelectedLineKey,
  displayMode = "cashier",
  pageSize = LINE_PAGE_SIZE,
}: {
  lines: SaleLineType[];
  lineOffset: number;
  selectedLineKey: string | null;
  setSelectedLineKey: (lineKey: string | null) => void;
  displayMode?: LineViewerDisplayMode;
  pageSize?: number;
}) {
  const classes = LINE_VIEWER_CLASSES[displayMode];

  const visibleLines = useMemo(
    () => lines.slice(lineOffset, lineOffset + pageSize),
    [lines, lineOffset, pageSize],
  );

  return (
    <div className="w-full h-full flex flex-col">
      <div className={classes.header}>
        <div className={classes.noColumn}>No.</div>
        <div className="flex-1">Item</div>
        <div className={classes.unitPriceColumn}>U. Price</div>
        <div className={classes.qtyColumn}>Qty</div>
        <div className={classes.totalColumn}>Total</div>
        <div className={classes.discountColumn}>DC</div>
      </div>
      <div
        className="flex-1 h-full overflow-hidden divide-y divide-gray-200"
        style={{
          display: "grid",
          gridTemplateRows: `repeat(${pageSize}, 1fr)`,
        }}
      >
        {Array.from({ length: pageSize }).map((_, index) => {
          const line = visibleLines[index];
          const isSelected = Boolean(line && selectedLineKey === line.lineKey);
          return (
            <div key={index}>
              {line && (
                <LineCaption
                  line={line}
                  isSelected={isSelected}
                  onClick={() =>
                    setSelectedLineKey(isSelected ? null : line.lineKey)
                  }
                  classes={classes}
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
  classes,
}: {
  line: SaleLineType;
  onClick: () => void;
  isSelected: boolean;
  classes: LineViewerClassSet;
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

  const discountPercentage =
    unit_price_original === 0
      ? 0
      : Math.max(
          0,
          ((unit_price_original - unit_price_effective) / unit_price_original) *
            100,
        );

  const discountText =
    discountPercentage > 0 ? `-${discountPercentage.toFixed(0)}%` : "";

  return (
    <div
      onClick={onClick}
      className={cn(classes.lineRoot, isSelected && "bg-blue-50")}
    >
      <div className={classes.noText}>
        {index + 1}
      </div>

      <div className={classes.itemCell}>
        <div className={classes.nameKo}>{name_ko}</div>
        <div className={classes.nameEn}>{name_en}</div>
        {measured_weight != null && measured_weight > 0 && (
          <div className={classes.weightText}>
            {fmtQty(measured_weight)}kg x{" "}
            {fmtMoney(line.unit_price_discounted ?? unit_price_original)}/kg
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex flex-col items-end justify-center p-1 min-w-0",
          classes.unitPriceColumn,
        )}
      >
        <div className={classes.moneyText}>
          {unit_price_adjusted && <span className="text-red-500">*</span>}
          {fmtMoney(displayPrice)}
        </div>
        {priceNotMatched && (
          <div className={classes.originalPriceText}>
            {fmtMoney(unit_price_original)}
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex flex-col items-end justify-center p-1 min-w-0",
          classes.qtyColumn,
        )}
      >
        <div className={classes.qtyText}>{fmtQty(displayQty)}</div>
      </div>

      <div
        className={cn(
          "flex flex-col items-end justify-center p-1 min-w-0",
          classes.totalColumn,
        )}
      >
        <div className={classes.totalText}>
          {taxable && <span className="text-red-500">*</span>}
          {fmtMoney(total)}
        </div>
      </div>
      <div
        className={cn(
          "flex flex-col items-end justify-center p-1 min-w-0",
          classes.discountColumn,
        )}
      >
        <div className={classes.discountText}>
          {discountText && <span className="text-red-500">{discountText}</span>}
        </div>
      </div>
    </div>
  );
}

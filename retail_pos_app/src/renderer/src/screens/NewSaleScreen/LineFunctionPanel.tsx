import { SaleLineType } from "../../types/sales";
import {
  ALLOWED_CHANGE_QTY_TYPES,
  useNewSalesStore,
} from "../../store/newSalesStore";
import { QTY_SCALE } from "../../libs/constants";
import { cn } from "../../libs/cn";

interface LineFunctionPanelProps {
  line: SaleLineType | null;
  onCancel: () => void;
  onOpenChangeQty: () => void;
  onOpenInjectPrice: () => void;
  onOpenDiscountAmount: () => void;
  onOpenDiscountPercent: () => void;
}

export default function LineFunctionPanel({
  line,
  onCancel,
  onOpenChangeQty,
  onOpenInjectPrice,
  onOpenDiscountAmount,
  onOpenDiscountPercent,
}: LineFunctionPanelProps) {
  const { changeLineQty, injectLinePrice, removeLine } = useNewSalesStore();

  if (line == null) return null;

  return (
    <div className="flex flex-col gap-8 p-2 h-full bg-zinc-200">
      {ALLOWED_CHANGE_QTY_TYPES.includes(line.type) && (
        <div className="grid grid-cols-3 gap-2">
          <Btn
            onClick={() => changeLineQty(line.lineKey, line.qty - QTY_SCALE)}
            label="-1"
          />
          <Btn
            onClick={() => changeLineQty(line.lineKey, line.qty + QTY_SCALE)}
            label="+1"
          />
          <Btn onClick={onOpenChangeQty} label="Change Qty" />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Btn onClick={onOpenDiscountAmount} label="Discount $" />
        <Btn onClick={onOpenDiscountPercent} label="Discount %" />
        <Btn onClick={onOpenInjectPrice} label="Override Price" />
        {line.unit_price_adjusted && (
          <div className="col-span-3">
            <Btn
              bg="bg-red-500 text-white"
              onClick={() => injectLinePrice(line.lineKey, null)}
              label="Clear Override Price"
            />
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col items-end justify-end">
        <div className="grid grid-cols-2 gap-2 w-full">
          <Btn
            onClick={() => removeLine(line.lineKey)}
            bg="bg-red-500 text-white"
            label="Remove"
          />
          <Btn onClick={onCancel} label="Close" bg="bg-blue-500 text-white" />
        </div>
      </div>
    </div>
  );
}

function Btn({
  label,
  onClick,
  bg,
}: {
  label: string;
  onClick: () => void;
  bg?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center justify-center w-full h-16 rounded-md border border-gray-300 font-bold text-lg",
        bg ?? "bg-zinc-900 text-green-600",
      )}
    >
      {label}
    </div>
  );
}

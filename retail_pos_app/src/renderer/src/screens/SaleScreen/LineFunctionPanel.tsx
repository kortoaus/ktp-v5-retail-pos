import { SaleLineType } from "../../types/sales";
import {
  ALLOWED_CHANGE_QTY_TYPES,
  useSalesStore,
} from "../../store/salesStore";
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
  const { changeLineQty, injectLinePrice, removeLine } = useSalesStore();

  if (line == null) return null;

  return (
    <div className="flex flex-col gap-8 p-2 h-full bg-zinc-200">
      {ALLOWED_CHANGE_QTY_TYPES.includes(line.type) && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <LineActionButton
              onClick={() => changeLineQty(line.lineKey, line.qty - 1)}
              label="-1"
            />
            <LineActionButton
              onClick={() => changeLineQty(line.lineKey, line.qty + 1)}
              label="+1"
            />
            <LineActionButton onClick={onOpenChangeQty} label="Change Qty" />
          </div>
        </>
      )}

      <div className="grid grid-cols-3 gap-2">
        <LineActionButton onClick={onOpenDiscountAmount} label="Discount $" />

        <LineActionButton onClick={onOpenDiscountPercent} label="Discount %" />

        <LineActionButton onClick={onOpenInjectPrice} label="Override Price" />

        {line.unit_price_adjusted && (
          <div className="col-span-3">
            <LineActionButton
              bgColor="bg-red-500 text-white"
              onClick={() => injectLinePrice(line.lineKey, null)}
              label="Clear Override Price"
            />
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col items-end justify-end">
        <div className="grid grid-cols-2 gap-2 w-full">
          <LineActionButton
            onClick={() => removeLine(line.lineKey)}
            bgColor="bg-red-500 text-white"
            label="Remove"
          />
          <LineActionButton
            onClick={onCancel}
            label="Close"
            bgColor="bg-blue-500 text-white"
          />
        </div>
      </div>
    </div>
  );
}

function LineActionButton({
  label,
  onClick,
  bgColor,
}: {
  label: string;
  onClick: () => void;
  bgColor?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "center w-full h-16 rounded-md border border-gray-300 font-bold text-lg",
        bgColor ? bgColor : "bg-zinc-900 text-green-600",
      )}
    >
      {label}
    </div>
  );
}

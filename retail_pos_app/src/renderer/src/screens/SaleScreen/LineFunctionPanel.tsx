import { SaleLineType } from "../../types/sales";
import { useSalesStore } from "../../store/salesStore";

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
    <div className="flex flex-col gap-2 p-2">
      <button
        type="button"
        onPointerDown={() => {
          const ask = confirm("Are you sure you want to remove this line?");
          if (ask) {
            removeLine(line.lineKey);
          }
        }}
        className="w-full py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
      >
        Remove
      </button>
      {line.type === "normal" && (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              onPointerDown={() => changeLineQty(line.lineKey, line.qty - 1)}
              className="flex-1 py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
            >
              −
            </button>
            <button
              type="button"
              onPointerDown={() => changeLineQty(line.lineKey, line.qty + 1)}
              className="flex-1 py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onPointerDown={onOpenChangeQty}
            className="w-full py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
          >
            Change Qty
          </button>
        </>
      )}
      <button
        type="button"
        onPointerDown={onOpenInjectPrice}
        className="w-full py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
      >
        Override Price
      </button>
      <button
        type="button"
        onPointerDown={onOpenDiscountAmount}
        className="w-full py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
      >
        Discount $
      </button>
      <button
        type="button"
        onPointerDown={onOpenDiscountPercent}
        className="w-full py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
      >
        Discount %
      </button>
      <button
        type="button"
        onPointerDown={() => injectLinePrice(line.lineKey, null)}
        className="w-full py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
      >
        Clear Override Price
      </button>

      <button
        onClick={onCancel}
        className="w-full py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
      >
        Cancel
      </button>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { SaleLineType } from "../../types/sales";
import { useSalesStore } from "../../store/salesStore";
import Numpad from "../../components/Numpads/Numpad";
import ModalContainer from "../../components/ModalContainer";
import { MONEY_DP } from "../../libs/constants";

interface DiscountPercentModalProps {
  open: boolean;
  onClose: () => void;
  line: SaleLineType | null;
}

export default function DiscountPercentModal({
  open,
  onClose,
  line,
}: DiscountPercentModalProps) {
  const [val, setVal] = useState("");
  const { injectLinePrice } = useSalesStore();

  useEffect(() => {
    if (!open) setVal("");
  }, [open]);

  const percent = parseFloat(val || "0");
  const original = line?.unit_price_original ?? 0;
  const adjusted = Math.round(original * (1 - percent / 100) * 1000) / 1000;
  const isValid = val !== "" && percent > 0 && percent <= 100 && adjusted >= 0;

  const handleConfirm = useCallback(() => {
    if (!line || !isValid) return;
    injectLinePrice(line.lineKey, adjusted);
    onClose();
  }, [line, isValid, adjusted, injectLinePrice, onClose]);

  return (
    <ModalContainer open={open} onClose={onClose} title="Discount by %">
      <div className="px-4 py-4">
        {line && (
          <div className="text-sm text-gray-500 mb-2 truncate">
            {line.name_en}
          </div>
        )}
        {line && (
          <div className="flex gap-4 text-lg text-red-500 mb-3">
            <span>Original: ${original.toFixed(MONEY_DP)}</span>
            <span>
              Result: ${isValid ? adjusted.toFixed(MONEY_DP) : "—"}
              {isValid && ` (−${percent}%)`}
            </span>
          </div>
        )}
        <Numpad val={val} setVal={setVal} useDot={true} maxDp={2} />
        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onPointerDown={onClose}
            className="flex-1 py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
          >
            Cancel
          </button>
          <button
            type="button"
            onPointerDown={handleConfirm}
            disabled={!isValid}
            className="flex-1 py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 disabled:opacity-30 font-medium text-base"
          >
            Confirm
          </button>
        </div>
      </div>
    </ModalContainer>
  );
}

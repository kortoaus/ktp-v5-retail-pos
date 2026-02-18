import { useCallback, useEffect, useState } from "react";
import { SaleLineType } from "../../types/sales";
import { useSalesStore } from "../../store/salesStore";
import Numpad from "../../components/Numpads/Numpad";
import ModalContainer from "../../components/ModalContainer";
import { MONEY_DP } from "../../libs/constants";

interface InjectPriceModalProps {
  open: boolean;
  onClose: () => void;
  line: SaleLineType | null;
}

export default function InjectPriceModal({
  open,
  onClose,
  line,
}: InjectPriceModalProps) {
  const [val, setVal] = useState("");
  const { injectLinePrice } = useSalesStore();

  useEffect(() => {
    if (!open) setVal("");
  }, [open]);

  const handleConfirm = useCallback(() => {
    if (!line) return;
    const price = parseFloat(val);
    if (isNaN(price) || price < 0) return;
    injectLinePrice(line.lineKey, price);
    onClose();
  }, [line, val, injectLinePrice, onClose]);

  return (
    <ModalContainer open={open} onClose={onClose} title="Override Price">
      <div className="px-4 py-4">
        {line && (
          <div className="text-sm text-gray-500 mb-2 truncate">
            {line.name_en}
          </div>
        )}
        {line && (
          <div className="flex gap-4 text-lg text-red-500 mb-3">
            <span>Original: ${line.unit_price_original.toFixed(MONEY_DP)}</span>
            <span>Current: ${line.unit_price_effective.toFixed(MONEY_DP)}</span>
          </div>
        )}
        <Numpad val={val} setVal={setVal} useDot={true} maxDp={3} />
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
            disabled={!val || isNaN(parseFloat(val)) || parseFloat(val) < 0}
            className="flex-1 py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 disabled:opacity-30 font-medium text-base"
          >
            Confirm
          </button>
        </div>
      </div>
    </ModalContainer>
  );
}

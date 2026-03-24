import { useCallback, useEffect, useState } from "react";
import { SaleLineType } from "../../types/sales";
import { useNewSalesStore } from "../../store/newSalesStore";
import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";
import Numpad from "../../components/Numpads/Numpad";
import ModalContainer from "../../components/ModalContainer";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

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
  const { injectLinePrice } = useNewSalesStore();

  useEffect(() => {
    if (!open) setVal("");
  }, [open]);

  const handleConfirm = useCallback(() => {
    if (!line) return;
    const dollars = parseFloat(val);
    if (isNaN(dollars) || dollars < 0) return;
    injectLinePrice(line.lineKey, Math.round(dollars * MONEY_SCALE));
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
            <span>Original: ${fmtMoney(line.unit_price_original)}</span>
            <span>Current: ${fmtMoney(line.unit_price_effective)}</span>
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

import { useCallback, useEffect, useState } from "react";
import { SaleLineType } from "../../types/sales";
import { useSalesStore } from "../../store/salesStore";
import Numpad from "../../components/Numpads/Numpad";
import ModalContainer from "../../components/ModalContainer";

interface ChangeQtyModalProps {
  open: boolean;
  onClose: () => void;
  line: SaleLineType | null;
}

export default function ChangeQtyModal({
  open,
  onClose,
  line,
}: ChangeQtyModalProps) {
  const [val, setVal] = useState("");
  const { changeLineQty } = useSalesStore();

  useEffect(() => {
    if (!open) setVal("");
  }, [open]);

  const handleConfirm = useCallback(() => {
    if (!line) return;
    const qty = parseFloat(val);
    if (isNaN(qty) || qty <= 0) return;
    changeLineQty(line.lineKey, qty);
    onClose();
  }, [line, val, changeLineQty, onClose]);

  return (
    <ModalContainer open={open} onClose={onClose} title="Change Quantity">
      <div className="px-4 py-4">
        {line && (
          <div className="text-sm text-gray-500 mb-2 truncate">
            {line.name_en}
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
            disabled={!val || parseFloat(val) <= 0}
            className="flex-1 py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 disabled:opacity-30 font-medium text-base"
          >
            Confirm
          </button>
        </div>
      </div>
    </ModalContainer>
  );
}

import { useCallback, useEffect, useState } from "react";
import { RefundableRow } from "../../types/models";
import { QTY_DP, QTY_SCALE } from "../../libs/constants";
import Numpad from "../../components/Numpads/Numpad";
import ModalContainer from "../../components/ModalContainer";

const fmtQty = (q: number) => (q / QTY_SCALE).toFixed(QTY_DP);

interface RefundQtyModalProps {
  open: boolean;
  onClose: () => void;
  row: RefundableRow | null;
  onConfirm: (qtyInt: number) => void;
}

export default function RefundQtyModal({
  open,
  onClose,
  row,
  onConfirm,
}: RefundQtyModalProps) {
  const [val, setVal] = useState("");

  useEffect(() => {
    if (!open) setVal("");
  }, [open]);

  const parsed = parseFloat(val);
  const qtyInt = Math.round(parsed * QTY_SCALE);
  const isValid =
    !isNaN(parsed) && parsed > 0 && row != null && qtyInt <= row.remainingQty;

  const handleConfirm = useCallback(() => {
    if (!row || !isValid) return;
    onConfirm(qtyInt);
  }, [row, isValid, qtyInt, onConfirm]);

  return (
    <ModalContainer open={open} onClose={onClose} title="Refund Quantity">
      <div className="px-4 py-4">
        {row && (
          <div className="mb-2">
            <div className="text-sm text-gray-500 truncate">{row.name_en}</div>
            <div className="text-xs text-gray-400">
              Remaining: {fmtQty(row.remainingQty)} / {fmtQty(row.qty)}
            </div>
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

import { useState, useEffect } from "react";
import { SaleStoreDiscount } from "../../types/sales";
import ModalContainer from "../../components/ModalContainer";
import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";
import { FaArrowUp, FaArrowDown } from "react-icons/fa6";
import { cn } from "../../libs/cn";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);
const PAGE_SIZE = 5;

interface DiscountListModalProps {
  open: boolean;
  onClose: () => void;
  discounts: SaleStoreDiscount[];
}

export default function DiscountListModal({
  open,
  onClose,
  discounts,
}: DiscountListModalProps) {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!open) setOffset(0);
  }, [open]);

  const maxOffset = Math.max(0, discounts.length - PAGE_SIZE);
  const visible = discounts.slice(offset, offset + PAGE_SIZE);

  return (
    <ModalContainer open={open} onClose={onClose} title="Applied Discounts">
      <div className="px-4 py-3">
        {discounts.length === 0 && (
          <div className="text-gray-400 text-sm text-center py-8">
            No discounts applied
          </div>
        )}
        {discounts.length > 0 && (
          <div className="flex flex-col divide-y divide-gray-200">
            {Array.from({ length: PAGE_SIZE }).map((_, i) => {
              const d = visible[i];
              if (!d) return <div key={i} className="h-14" />;
              return (
                <div
                  key={`${d.entityType}-${d.entityId}`}
                  className="flex items-center justify-between h-14"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {d.title}
                    </div>
                    <div className="text-xs text-gray-400">{d.description}</div>
                  </div>
                  <div className="text-green-600 font-bold text-base px-4">
                    -${fmtMoney(d.amount)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {discounts.length > PAGE_SIZE && (
          <div className="flex items-center justify-center gap-4 pt-3">
            <button
              type="button"
              onPointerDown={() => setOffset(Math.max(0, offset - 1))}
              disabled={offset <= 0}
              className={cn(
                "w-12 h-12 rounded-lg flex items-center justify-center text-white",
                offset <= 0
                  ? "bg-gray-300"
                  : "bg-slate-500 active:bg-slate-600",
              )}
            >
              <FaArrowUp />
            </button>
            <span className="text-sm text-gray-500">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, discounts.length)} of{" "}
              {discounts.length}
            </span>
            <button
              type="button"
              onPointerDown={() => setOffset(Math.min(maxOffset, offset + 1))}
              disabled={offset >= maxOffset}
              className={cn(
                "w-12 h-12 rounded-lg flex items-center justify-center text-white",
                offset >= maxOffset
                  ? "bg-gray-300"
                  : "bg-slate-500 active:bg-slate-600",
              )}
            >
              <FaArrowDown />
            </button>
          </div>
        )}
      </div>
    </ModalContainer>
  );
}

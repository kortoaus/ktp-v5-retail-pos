import { useEffect, useState } from "react";
import ModalContainer from "../../components/ModalContainer";
import Numpad from "../../components/Numpads/Numpad";
import { cn } from "../../libs/cn";
import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";
import { editPriceLevel, padToLevelCount } from "../../libs/scale-price-levels";
import { PRICE_LEVEL_COUNT } from "../../scale-core/weigh-pricing";

/**
 * The five-level price editor.
 *
 * Level 0 is the public price, levels 1–4 the member tiers. Typing into a level
 * **fills down** to level 4 (`editPriceLevel`) — the retired scale terminal's
 * habit, kept because that is how the tiers are actually decided.
 *
 * The edit is session-local: nothing is written back to the catalogue. It moves
 * two things — the face price the label prints (lowest-of, level 0) and the PP
 * payload's `02`/`03` arrays, which carry every level to the till.
 */
export default function PriceLevelsModal({
  open,
  title,
  values,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  values: number[] | null;
  onConfirm: (next: number[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<number[]>([]);
  const [level, setLevel] = useState(0);
  const [entry, setEntry] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(padToLevelCount(values));
    setLevel(0);
    setEntry("");
  }, [open, values]);

  const commitEntry = (nextLevel: number) => {
    const dollars = Number.parseFloat(entry);
    if (entry !== "" && Number.isFinite(dollars) && dollars >= 0) {
      setDraft((prev) => editPriceLevel(prev, level, Math.round(dollars * MONEY_SCALE)));
    }
    setEntry("");
    setLevel(nextLevel);
  };

  return (
    <ModalContainer open={open} onClose={onClose} title={title} maxWidth="max-w-xl">
      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: PRICE_LEVEL_COUNT }).map((_, i) => (
            <div
              key={i}
              onPointerDown={() => commitEntry(i)}
              className={cn(
                "h-16 rounded-lg border flex flex-col items-center justify-center cursor-pointer",
                level === i
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-700",
              )}
            >
              <span className="text-[10px] font-bold uppercase text-gray-400">
                {i === 0 ? "Public" : `Lv.${i}`}
              </span>
              <span className="text-base font-bold tabular-nums">
                {((draft[i] ?? 0) / MONEY_SCALE).toFixed(MONEY_DP)}
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-400">
          Entering a price fills every level below it. Levels past 4, if this item
          has any, are left untouched.
        </p>

        <Numpad val={entry} setVal={setEntry} useDot={true} maxDp={2} />

        <div className="flex gap-3">
          <button
            type="button"
            onPointerDown={onClose}
            className="flex-1 py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onPointerDown={() => {
              // `draft` started as `padToLevelCount(values)`, which keeps any
              // tail past level 4, and `editPriceLevel` only writes inside the
              // window — so the array handed back is still the length the
              // server sent, which is what the PP payload needs.
              const dollars = Number.parseFloat(entry);
              onConfirm(
                entry !== "" && Number.isFinite(dollars) && dollars >= 0
                  ? editPriceLevel(draft, level, Math.round(dollars * MONEY_SCALE))
                  : draft,
              );
            }}
            className="flex-1 py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 font-medium"
          >
            Apply
          </button>
        </div>
      </div>
    </ModalContainer>
  );
}

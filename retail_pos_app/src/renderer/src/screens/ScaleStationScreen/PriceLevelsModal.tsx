import { useEffect, useRef, useState } from "react";
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
  onChange,
  onClose,
}: {
  open: boolean;
  title: string;
  values: number[] | null;
  /** Fired on every keypad change — edits are live, there is no Apply step. */
  onChange: (next: number[]) => void;
  onClose: () => void;
}) {
  const [initial, setInitial] = useState<number[]>([]);
  const [draft, setDraft] = useState<number[]>([]);
  const [level, setLevel] = useState(0);
  const [entry, setEntry] = useState("");

  // Reset on OPEN only. `values` is the parent's live state and `onChange`
  // gives it a new identity on every keystroke — keying this effect on it
  // would blank the entry after each digit and overwrite CLS's restore point
  // with whatever was just typed (caught by the runner port's review).
  const valuesRef = useRef(values);
  valuesRef.current = values;
  useEffect(() => {
    if (!open) return;
    const padded = padToLevelCount(valuesRef.current);
    setInitial(padded);
    setDraft(padded);
    setLevel(0);
    setEntry("");
  }, [open]);

  // Live editing (owner, 2026-08-28): every keypad change lands in the draft
  // and the parent immediately; an emptied entry keeps the last committed
  // figure rather than reverting.
  const handleEntry = (next: string) => {
    setEntry(next);
    const dollars = Number.parseFloat(next);
    if (next !== "" && Number.isFinite(dollars) && dollars >= 0) {
      const applied = editPriceLevel(draft, level, Math.round(dollars * MONEY_SCALE));
      setDraft(applied);
      onChange(applied);
    }
  };

  const pickLevel = (nextLevel: number) => {
    // Tapping the level being edited starts its entry over — nothing changes
    // until the next digit.
    setEntry("");
    if (nextLevel !== level) setLevel(nextLevel);
  };

  return (
    <ModalContainer open={open} onClose={onClose} title={title} maxWidth="max-w-xl">
      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: PRICE_LEVEL_COUNT }).map((_, i) => (
            <div
              key={i}
              onPointerDown={() => pickLevel(i)}
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

        <Numpad val={entry} setVal={handleEntry} useDot={true} maxDp={2} />

        <div className="flex gap-3">
          <button
            type="button"
            onPointerDown={() => {
              // CLS: back to the values the modal opened with, live.
              setDraft(initial);
              setEntry("");
              onChange(initial);
            }}
            className="flex-1 py-3 rounded-xl bg-red-600 text-white active:bg-red-700 font-medium"
          >
            CLS
          </button>
          <button
            type="button"
            onPointerDown={onClose}
            className="flex-1 py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </ModalContainer>
  );
}

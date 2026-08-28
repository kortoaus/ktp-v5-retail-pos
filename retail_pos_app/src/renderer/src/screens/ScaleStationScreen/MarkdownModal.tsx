import { useEffect, useState } from "react";
import ModalContainer from "../../components/ModalContainer";
import Numpad from "../../components/Numpads/Numpad";
import { MONEY_SCALE, PCT_SCALE } from "../../libs/constants";
import type { ScaleLabelMarkdown } from "../../scale-core/label-data";

/**
 * Markdown entry — percent or dollars, one at a time.
 *
 * Units follow the PP `05`/`06` spec exactly, so nothing is converted between
 * here and the payload: percent is permill (10% = 100), dollars are cents.
 *
 * A markdown reaches the printed total **and** the 1D embedded price, so a
 * label printed with one rings up the marked-down amount. It reaches the PP
 * payload only as `05`/`06`, never folded into the `02`/`03` arrays. Both rules
 * live in `scale-core/label-data.ts`; this screen just collects the number.
 *
 * Over-100% and over-price entries are clamped to $0.00 by `scale-core`, not
 * rejected here — the clamp is the thing that has to be in the maths.
 */
export default function MarkdownModal({
  open,
  kind,
  current,
  onConfirm,
  onClose,
}: {
  open: boolean;
  kind: "pct" | "amt";
  current: ScaleLabelMarkdown | null;
  onConfirm: (next: ScaleLabelMarkdown | null) => void;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState("");

  useEffect(() => {
    if (!open) return;
    if (current && current.type === kind && current.value > 0) {
      setEntry(
        kind === "pct"
          ? String(current.value / (PCT_SCALE / 100))
          : String(current.value / MONEY_SCALE),
      );
    } else {
      setEntry("");
    }
  }, [open, kind, current]);

  const typed = Number.parseFloat(entry);
  const valid = entry !== "" && Number.isFinite(typed) && typed > 0;
  const value = valid
    ? kind === "pct"
      ? Math.round(typed * (PCT_SCALE / 100))
      : Math.round(typed * MONEY_SCALE)
    : 0;

  return (
    <ModalContainer
      open={open}
      onClose={onClose}
      title={kind === "pct" ? "% Markdown" : "$ Markdown"}
    >
      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="text-sm text-gray-500">
          {kind === "pct"
            ? "Percent off the calculated total (e.g. 30 = 30% off)."
            : "Dollars off the calculated total (e.g. 1.50)."}
        </div>

        <Numpad val={entry} setVal={setEntry} useDot={true} maxDp={2} />

        <div className="flex gap-3">
          <button
            type="button"
            onPointerDown={() => onConfirm(null)}
            className="flex-1 py-3 rounded-xl bg-red-600 text-white active:bg-red-700 font-medium"
          >
            Remove
          </button>
          <button
            type="button"
            onPointerDown={onClose}
            className="flex-1 py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid}
            onPointerDown={() => onConfirm(valid ? { type: kind, value } : null)}
            className="flex-1 py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 disabled:opacity-30 font-medium"
          >
            Apply
          </button>
        </div>
      </div>
    </ModalContainer>
  );
}

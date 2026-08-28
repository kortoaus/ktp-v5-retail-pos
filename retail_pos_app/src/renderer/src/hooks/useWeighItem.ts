import { useCallback, useEffect, useMemo, useState } from "react";
import { searchItemById } from "../service/item.service";
import { Item } from "../types/models";
import {
  addDaysIso,
  buildScaleLabelData,
  isWeighedItem,
  sydneyTodayIso,
} from "../label-core/adapters/scale-label";
import type { ScaleLabelState } from "../label-core/adapters/scale-label";
import type { ScaleLabelData, ScaleLabelMarkdown } from "../scale-core/label-data";
import {
  applyMarkdown,
  computeTotalCents,
  parseWeightGrams,
  resolveFacePrice,
} from "../scale-core/weigh-pricing";

/**
 * The `/scale` detail screen's state.
 *
 * The screen assembles; this hook owns the editable form and every derived
 * figure. No maths lives here — face price, total, markdown clamping and the
 * label data all come from `scale-core`, and the `Item` → template mapping from
 * `label-core/adapters/scale-label`.
 *
 * ## Prices are level arrays, not a number
 *
 * `prices` / `promoPrices` are held **at the length the server sent**, because
 * the 2D PP payload has to carry the original arrays through unfolded (the
 * anti-double-discount invariant at the top of `scale-core/label-data.ts`).
 * The editor writes into indexes 0..4 and leaves any tail alone. Overrides are
 * session-local: nothing is written back to the catalogue, the same as the
 * retired scale terminal.
 *
 * ## The item is always re-fetched
 *
 * `GET /api/item/search/id/:id`, never the browse grid's snapshot — a grid page
 * can be minutes old and a price can have moved under it. Same convention the
 * legacy `/scale?itemId=` screen used.
 */

export interface UseWeighItemReturn {
  item: Item | null;
  loading: boolean;
  loadError: string | null;

  isWeighed: boolean;
  fixedWeightString: string;
  ingredients: string;

  /** Level arrays, length preserved. The UI reads and edits 0..4. */
  prices: number[] | null;
  setPrices: (next: number[]) => void;
  promoPrices: number[] | null;
  setPromoPrices: (next: number[]) => void;
  markdown: ScaleLabelMarkdown | null;
  setMarkdown: (next: ScaleLabelMarkdown | null) => void;

  packedOnIso: string;
  usedByIso: string;
  usedByOffsetDays: number;
  packedOnChanged: boolean;
  shiftPackedOn: (days: number) => void;
  resetPackedOn: () => void;

  /** Level-0 lowest-of result. */
  originalCents: number;
  unitPriceCents: number | null;
  wasPriceCents: number | null;
  baseTotalCents: number | null;
  totalCents: number | null;
  hasMarkdown: boolean;

  /** What the adapter needs; null until the item has loaded. */
  labelState: ScaleLabelState | null;
  /** `ScaleLabelData` = printable, string = the reason, null = no item yet. */
  label: ScaleLabelData | string | null;
}

export function useWeighItem(
  itemId: number | null,
  /** The scale reader's weight string — five padded grams. */
  weight: string,
): UseWeighItemReturn {
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [prices, setPrices] = useState<number[] | null>(null);
  const [promoPrices, setPromoPrices] = useState<number[] | null>(null);
  const [markdown, setMarkdown] = useState<ScaleLabelMarkdown | null>(null);
  const [packedOnIso, setPackedOnIso] = useState(() => sydneyTodayIso());
  const [usedByOffsetDays, setUsedByOffsetDays] = useState(1);

  useEffect(() => {
    if (itemId == null) {
      setItem(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      setItem(null);
      const res = await searchItemById(itemId);
      if (cancelled) return;
      if (res.ok && res.result) {
        const loaded = res.result;
        setItem(loaded);
        setPrices(loaded.price?.prices ?? null);
        setPromoPrices(loaded.promoPrice?.prices ?? null);
        setMarkdown(null);
        setPackedOnIso(sydneyTodayIso());
        setUsedByOffsetDays(loaded.scaleData?.usedBy ?? 1);
      } else {
        setLoadError(res.msg || "Failed to load item.");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // ── dates: data is ISO, used-by is derived from packed-on + offset ────────
  const usedByIso = useMemo(
    () => addDaysIso(packedOnIso, usedByOffsetDays),
    [packedOnIso, usedByOffsetDays],
  );
  const packedOnChanged = packedOnIso !== sydneyTodayIso();

  const shiftPackedOn = useCallback((days: number) => {
    setPackedOnIso((prev) => addDaysIso(prev, days));
  }, []);
  const resetPackedOn = useCallback(() => {
    setPackedOnIso(sydneyTodayIso());
  }, []);

  // ── derived figures, all from scale-core ─────────────────────────────────
  const isWeighed = item ? isWeighedItem(item) : false;
  const fixedWeightString = item?.scaleData?.fixedWeightString ?? "";
  const ingredients = item?.scaleData?.ingredients ?? "";

  const face = resolveFacePrice(prices, promoPrices, 0);
  const unitPriceCents = face.effectiveCents > 0 ? face.effectiveCents : null;
  const wasPriceCents = face.discountedCents != null ? face.originalCents : null;

  const weightGrams = parseWeightGrams(weight);
  const baseTotalCents = computeTotalCents(unitPriceCents, isWeighed, weightGrams);
  const hasMarkdown = markdown != null && markdown.value > 0;
  const totalCents =
    baseTotalCents != null && hasMarkdown && markdown != null
      ? applyMarkdown(baseTotalCents, markdown.type, markdown.value)
      : baseTotalCents;

  const labelState: ScaleLabelState | null = useMemo(
    () =>
      item
        ? { item, weight, prices, promoPrices, markdown, packedOnIso, usedByOffsetDays }
        : null,
    [item, weight, prices, promoPrices, markdown, packedOnIso, usedByOffsetDays],
  );

  const label = useMemo(
    () => (labelState ? buildScaleLabelData(labelState) : null),
    [labelState],
  );

  return {
    item,
    loading,
    loadError,

    isWeighed,
    fixedWeightString,
    ingredients,

    prices,
    setPrices,
    promoPrices,
    setPromoPrices,
    markdown,
    setMarkdown,

    packedOnIso,
    usedByIso,
    usedByOffsetDays,
    packedOnChanged,
    shiftPackedOn,
    resetPackedOn,

    originalCents: face.originalCents,
    unitPriceCents,
    wasPriceCents,
    baseTotalCents,
    totalCents,
    hasMarkdown,

    labelState,
    label,
  };
}

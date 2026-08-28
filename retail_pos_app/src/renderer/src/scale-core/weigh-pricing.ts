/**
 * scale-core — weighing price maths.
 *
 * ## This file is the canon
 *
 * These modules were written in `ktpv5-retail-runner`
 * (`src/shared/scale-core/`) while the runner was the only scale client. The
 * POS `/scale` station is now the production weighing terminal, so **this copy
 * is the canonical one and the runner's becomes a sync target** — the same
 * relationship `label-core` and `sale-core` already have with the other repos.
 * Fix a rule here first, then copy the file across; never the other way round.
 *
 * ## The rules the directory lives by
 *
 * Pure TypeScript: no DOM, no node, no electron, no react, and no import that
 * leaves this directory. That is what lets the files be copied verbatim and run
 * directly under `node --test` (`npm run test:scale-core`).
 *
 * The scale constants below are fleet-wide values — the same numbers as
 * `libs/constants.ts` — and are redefined here rather than imported for exactly
 * that reason: a relative import into `libs/` would break in every repo this
 * directory is copied to. Two copies of a constant is the price; the comment is
 * the record that they are one value.
 */

/** Cent scale — same value as the fleet-wide `MONEY_SCALE`. */
export const MONEY_SCALE = 100;
/** Gram scale — same value as the fleet-wide `QTY_SCALE` (1 kg = 1000). */
export const QTY_SCALE = 1000;
/** Permill scale — same value as the fleet-wide `PCT_SCALE` (10% = 100). */
export const PCT_SCALE = 1000;

/**
 * A scale reader's output (`"01036"`, five padded grams) as an integer.
 *
 * `parseInt` semantics, kept verbatim from the legacy `labelUtils`: anything
 * non-numeric reads as 0 rather than throwing, because a garbled serial frame
 * must not take the weighing screen down.
 */
export function parseWeightGrams(weight: string): number {
  const parsed = Number.parseInt(weight, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * How many price levels the UI edits — **owner decision (2026-08-21): five,
 * indexes 0..4**. Index 0 is the public (non-member) price, N the member price
 * for level N.
 *
 * This is the size of the window the UI reads and writes, *not* the length of
 * the array. An array that arrives from the server is kept at **the length it
 * arrived with**, because the 2D PP barcode has to carry the original array
 * through unchanged.
 */
export const PRICE_LEVEL_COUNT = 5;

export type ResolvedFacePrice = {
  /** Shelf price (cents) — `prices[0] ?? 0`, level-independent, as in the POS. */
  originalCents: number;
  /** Applied price (cents) — the lowest discount candidate, else the shelf price. */
  effectiveCents: number;
  /** The discount that applied (cents), or null. Only then is a `was` line printed. */
  discountedCents: number | null;
};

/**
 * The face price — the canonical **lowest-of** rule.
 *
 * A mirror of the POS's own `SalesStore.helper.ts resolveDiscountedPrice`, at
 * level 0 (a scale label is anonymous). Candidates are
 * `prices[0..level] ∪ promoPrices[0..level]` filtered to those that are `> 0`
 * **and below** the shelf price (`prices[0] ?? 0`); the discount is the minimum
 * of what survives, or null.
 *
 * A promo *above* the shelf price is rejected. That is a deliberate correction
 * of the legacy scale terminal's "promo always wins" rule, which printed the
 * higher of the two whenever a stale promo row outlived a price drop.
 *
 * Validity windows and archived rows are not checked here: the server
 * (`patchItemPriceService`) already filters both, so a `promoPrice` that
 * arrives is a live one.
 */
export function resolveFacePrice(
  prices: number[] | null | undefined,
  promoPrices: number[] | null | undefined,
  level = 0,
): ResolvedFacePrice {
  const originalCents = prices?.[0] ?? 0;
  const maxLevel = Math.max(0, level);
  const candidates = [
    ...(prices?.slice(0, maxLevel + 1) ?? []),
    ...(promoPrices?.slice(0, maxLevel + 1) ?? []),
  ].filter((p) => p > 0 && p < originalCents);

  const discountedCents = candidates.length > 0 ? Math.min(...candidates) : null;
  return {
    originalCents,
    effectiveCents: discountedCents ?? originalCents,
    discountedCents,
  };
}

/**
 * Percent markdown, in permill (10% = 100).
 *
 * Same formula and same clamp as the canonical `libs/pp-barcode.ts
 * calcMarkdownPrice` percent branch. **The clamp is not optional**: the legacy
 * scale fork had none, so a markdown over 100% produced a negative price and an
 * embedded barcode nobody could scan. Over 100% floors at zero.
 */
export function applyPctMarkdown(cents: number, permill: number): number {
  return Math.max(0, Math.round((cents * (PCT_SCALE - permill)) / PCT_SCALE));
}

/**
 * Dollar markdown, in cents — `max(0, cents − amountCents)`, the amount branch
 * of `calcMarkdownPrice`. An amount above the price floors at zero, same clamp.
 */
export function applyAmtMarkdown(cents: number, amountCents: number): number {
  return Math.max(0, cents - amountCents);
}

/** Markdown kind — the same vocabulary as the PP `05` field (1 = pct, 2 = amt). */
export type MarkdownKind = "pct" | "amt";

/** `calcMarkdownPrice(effectivePrice, type, amount)`: pct is permill, amt is cents. */
export function applyMarkdown(
  cents: number,
  kind: MarkdownKind,
  value: number,
): number {
  return kind === "pct" ? applyPctMarkdown(cents, value) : applyAmtMarkdown(cents, value);
}

/**
 * The amount charged (cents).
 *
 * The legacy rounding order is kept exactly: multiply the **dollar** unit price
 * by kilograms and round **once**, at the end. Rounding to cents first and then
 * multiplying drifts by a cent on ordinary weights, and the drift shows up
 * between the printed total and the embedded barcode.
 *
 * A fixed-weight item's unit price is its total.
 *
 * Returns null when no price can be formed — no unit price, or a weighed item
 * with nothing on the platter.
 */
export function computeTotalCents(
  unitPriceCents: number | null,
  isWeight: boolean,
  weightGrams: number,
): number | null {
  if (unitPriceCents == null) return null;
  if (!isWeight) return unitPriceCents;

  const weightInKg = weightGrams ? weightGrams / QTY_SCALE : 0;
  if (!weightInKg) return null;

  return Math.round((unitPriceCents / MONEY_SCALE) * weightInKg * MONEY_SCALE);
}

/** Cents → `"12.34"`, the label data's dollar notation. */
export function formatCentsToDollars(cents: number): string {
  return (cents / MONEY_SCALE).toFixed(2);
}

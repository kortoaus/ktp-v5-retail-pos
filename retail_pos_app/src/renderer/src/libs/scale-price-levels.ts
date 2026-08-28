/**
 * Editing a price **level array** on the `/scale` station.
 *
 * Pure, and colocated with `pp-barcode.ts` for the same reason: it is money
 * logic that a component would otherwise hide, and it is covered by
 * `npm run test:label-core`.
 *
 * ## Fill-down
 *
 * Typing a price into level *i* sets levels *i* through the last edited level
 * to that value. That is the retired scale terminal's input habit and it
 * matches how the prices are actually decided — "from this tier down, this is
 * the price" — so it is kept rather than made into per-cell editing.
 *
 * ## The array's length is not the UI's business
 *
 * `PRICE_LEVEL_COUNT` (5, owner decision) is the size of the **window the UI
 * edits**, not the length of the array. A shorter array is zero-padded up to
 * the window; a longer one keeps its tail untouched, because the 2D PP payload
 * carries the array through verbatim and truncating it here would quietly drop
 * member tiers off the label. The legacy editor replaced any array that was not
 * exactly ten long with a fresh zero array — that is the bug this avoids.
 *
 * Both functions always return a new array; the input is never mutated.
 */

import { PRICE_LEVEL_COUNT } from "../scale-core/weigh-pricing";

/** An editable copy: padded up to `levelCount`, longer arrays left as they are. */
export function padToLevelCount(
  prices: number[] | null | undefined,
  levelCount: number = PRICE_LEVEL_COUNT,
): number[] {
  const next = prices ? [...prices] : [];
  while (next.length < levelCount) next.push(0);
  return next;
}

/**
 * Write `cents` into `level` and fill down to the end of the edit window.
 *
 * Levels at or past `levelCount` are untouched. A negative level is treated as
 * 0; a level at or past the window is a no-op that still returns the padded
 * copy.
 */
export function editPriceLevel(
  prices: number[] | null | undefined,
  level: number,
  cents: number,
  levelCount: number = PRICE_LEVEL_COUNT,
): number[] {
  const next = padToLevelCount(prices, levelCount);
  for (let i = Math.max(0, level); i < levelCount; i += 1) {
    next[i] = cents;
  }
  return next;
}

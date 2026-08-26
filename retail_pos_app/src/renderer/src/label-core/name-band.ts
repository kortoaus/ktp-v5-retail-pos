/**
 * The product-name band, shared by every label that prints one.
 *
 * Both scale labels set the English name the same way — one big line when it
 * measures short enough, two smaller ones when it does not — and they differ
 * only in the numbers: the 60 × 40 band is 450 dots wide and 30/24, the 58 × 100
 * band is 424 dots wide and 34/26. The rule was written twice before this file
 * existed; it is here so the *rule* has one home and each template owns only its
 * geometry.
 *
 * The 5% held back (`NAME_BAND_FIT`) is the load-bearing part. `^FB` wraps at
 * the block width exactly and `measure.ts` is an approximation fitted to a
 * hardware sample, so a name measuring 449 of 450 is a coin toss between one
 * line and a printer-wrapped second line *at the one-line size* — which
 * overflows the band. Holding 5% back turns that coin toss into a deliberate
 * two-line layout.
 *
 * The two-line shrink is resolved here rather than by setting `shrink` on the
 * element, because the emitter's budget is `width * lines` — the full block —
 * and would spend the margin the one/two-line decision was made against. One
 * margin, one place, or the two branches disagree about what "fits" means.
 */

import { fitSize, textWidth } from "./measure";

/** How the name is set: the size, how many lines it may use, and its `y`. */
export interface NameBandLayout {
  size: number;
  lines: 1 | 2;
  y: number;
}

/** One band's geometry — every number a template has to supply. */
export interface NameBandSpec {
  /** Block width in dots. */
  width: number;
  /** The size a name that fits gets. */
  oneLineSize: number;
  /** The size a name that does not fit drops to. */
  twoLineSize: number;
  /** Below this a name is unreadable at arm's length; clipping beats illegible. */
  minSize: number;
  /** `y` for the one-line case. */
  yOne: number;
  /** `y` for the two-line case — often the same, sometimes moved up. */
  yTwo: number;
  /** Fraction of the block a name may measure before it is given a second line. */
  fit?: number;
}

/** See the header — 5% is what makes the one/two-line decision deliberate. */
export const NAME_BAND_FIT = 0.95;

/**
 * Size, line count and `y` for a name set in `spec`'s band.
 *
 * Three cases, in order:
 *
 *  1. It measures inside `fit` of the block at `oneLineSize` → one line, at `yOne`.
 *  2. It does not → **two** lines at `twoLineSize`, at `yTwo`.
 *  3. It does not fit two lines of `twoLineSize` either → the same two lines,
 *     shrunk by `fitSize` to whatever does fit, and never below `minSize`.
 *
 * Pure, so the boundary can be tested without rendering a label.
 */
export function layoutNameBand(nameEn: string, spec: NameBandSpec): NameBandLayout {
  const text = (nameEn ?? "").trim();
  const budget = spec.width * (spec.fit ?? NAME_BAND_FIT);

  if (textWidth(text, spec.oneLineSize) <= budget) {
    return { size: spec.oneLineSize, lines: 1, y: spec.yOne };
  }

  return {
    size: fitSize(text, budget * 2, spec.twoLineSize, spec.minSize),
    lines: 2,
    y: spec.yTwo,
  };
}

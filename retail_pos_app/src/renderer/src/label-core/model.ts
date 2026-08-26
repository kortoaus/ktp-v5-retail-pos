/**
 * The declarative label model.
 *
 * Plain data, no classes, no builder: a label is a `media` id plus a flat list
 * of elements, every coordinate an integer dot with the origin at the top-left
 * corner of the label. Templates are functions from domain data to this shape,
 * which is what makes them testable without a printer and portable to the other
 * two repos that need to print the same labels.
 *
 * Nothing here knows about ZPL. `zpl.ts` is the only module that emits
 * commands, so a second dialect (or a preview renderer) can be added by writing
 * another emitter over this model rather than by touching templates.
 */

import type { FontWeight } from "./fonts";
import type { MediaId } from "./media";

export type Align = "L" | "C" | "R";

export interface Text {
  kind: "text";
  x: number;
  y: number;
  text: string;
  /** Cell height in dots; the advance width is derived from it. */
  size: number;
  weight?: FontWeight;
  /** `noto` (default) needs the TTF installed; `builtin` is ASCII-only. */
  font?: "noto" | "builtin";
  /** Block width in dots. Required for wrapping, alignment and shrinking. */
  width?: number;
  /** Maximum lines the block may wrap to. Defaults to 1. */
  lines?: number;
  align?: Align;
  /** Reduce `size` until the text fits `width` (never below `minSize`). */
  shrink?: boolean;
  minSize?: number;
}

export interface Line {
  kind: "line";
  x: number;
  y: number;
  w: number;
  h: number;
  thick: number;
}

export interface Box {
  kind: "box";
  x: number;
  y: number;
  w: number;
  h: number;
  thick: number;
}

export type BarcodeSymbology = "ean13" | "code128";

export interface Barcode {
  kind: "barcode";
  sym: BarcodeSymbology;
  x: number;
  y: number;
  /** Bar height in dots, excluding the human-readable line. */
  h: number;
  /** Narrow-bar width in dots (1-10). Defaults to 2. */
  module?: number;
  /** Print the human-readable interpretation under the bars. Defaults to true. */
  hri?: boolean;
  /** ean13 takes 12 digits — the printer computes the check digit. */
  data: string;
}

export type QrEc = "L" | "M" | "Q" | "H";

/**
 * Which corner `x, y` names.
 *
 * `top` (the default) is the top-left corner — `^FO`, the same as every other
 * element. `bottom` is the bottom-left corner: the symbol's baseline is fixed
 * and it grows *upward* as the payload gets longer.
 *
 * This exists because of how Zebra draws `^BQ` under `^FO`: the symbol is
 * bottom-aligned inside a box sized for the largest symbol that magnification
 * can produce, so a short payload prints lower on the label than a long one and
 * the top edge moves with the data. When the symbol has to clear a pre-printed
 * rule (the 60 × 40 stock's red line at y ≈ 229) that is exactly backwards —
 * anchoring the bottom is what keeps it off the rule. Verified on a ZD421.
 */
export type QrAnchor = "top" | "bottom";

export interface Qr {
  kind: "qr";
  x: number;
  y: number;
  /** Module magnification (1-10). */
  mag: number;
  /**
   * Requested error-correction level.
   *
   * **Ignored by the emitter.** ZD421 firmware takes the level from the field
   * data, not from `^BQ`'s parameters, and the emitter always sends `LA,` (see
   * `zpl.ts`). The field is kept so templates that set it still compile and so
   * a future emitter that can honour it has somewhere to read it from.
   */
  ec?: QrEc;
  /** Defaults to `top`. */
  anchor?: QrAnchor;
  data: string;
}

export interface DataMatrix {
  kind: "datamatrix";
  x: number;
  y: number;
  /** Module height in dots. */
  size: number;
  data: string;
}

export type Element = Text | Line | Box | Barcode | Qr | DataMatrix;

export interface Label {
  media: MediaId;
  elements: Element[];
  /** Copies of this label. Emitted as ^PQ only when greater than 1. */
  copies?: number;
  /** Draw a 1-dot outline around every element — coordinate tuning aid. */
  dbg?: boolean;
}

/** Default strikethrough thickness in dots. */
export const STRIKE_THICK = 2;

/**
 * A rule across `w` dots — the "was $9.99" line through an old price.
 *
 * It is a `Line` like any other; the helper exists so templates say what they
 * mean and so the thickness stays consistent between them.
 */
export function strike(x: number, y: number, w: number, thick: number = STRIKE_THICK): Line {
  return { kind: "line", x, y, w, h: thick, thick };
}

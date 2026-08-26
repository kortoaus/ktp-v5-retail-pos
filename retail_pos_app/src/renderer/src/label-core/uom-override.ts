/**
 * Correcting a pre-printed unit caption.
 *
 * Both scale webs are bought with `$/KG` already printed on them, because the
 * overwhelming majority of what goes over a scale is weighed. An each-priced
 * item on the same stock — `1 EA` for $1.30 — would otherwise read as $1.30 per
 * kilogram, which is a pricing claim, not a cosmetic slip. The legacy scale
 * terminal handled it by ruling the caption out and writing the real unit
 * beside it, and that is what this reproduces.
 *
 * Nothing but the unit decides it: `kg` prints nothing at all (the stock is
 * already right), anything else prints the rule and the replacement.
 *
 * The rule's rect is hand-measured off the artwork rather than derived. The
 * caption is somebody else's printing — there is no glyph metric here that
 * describes it, so the number comes from a ruler on real stock and belongs in
 * the template that was tuned against that stock.
 */

import type { FontWeight } from "./fonts";
import { strike, type Element } from "./model";

/** The rule that crosses the pre-printed caption. Hand-measured, in dots. */
export interface UomCaptionRect {
  x: number;
  y: number;
  w: number;
}

export interface UomOverrideSpec {
  /** Where to rule out the pre-printed `$/KG`. */
  captionRect: UomCaptionRect;
  /** Top-left of the replacement caption. */
  textPos: { x: number; y: number };
  /** Cell height of the replacement caption. */
  size: number;
  /** Defaults to Bold — the replacement has to hold its own beside the artwork. */
  weight?: FontWeight;
}

/** The unit the stock already prints, so nothing is drawn for it. */
export const PREPRINTED_UOM = "KG";

/**
 * `[]` for a kilogram item; a rule plus `$/<UNIT>` for anything else.
 *
 * The replacement is upper-cased to match the pre-printed caption's own
 * typography — `$/ea` beside a black `$/KG` box reads as a smudge.
 */
export function uomOverride(unit: string, spec: UomOverrideSpec): Element[] {
  const uom = (unit ?? "").trim().toUpperCase();
  if (!uom || uom === PREPRINTED_UOM) return [];

  return [
    strike(spec.captionRect.x, spec.captionRect.y, spec.captionRect.w),
    {
      kind: "text",
      x: spec.textPos.x,
      y: spec.textPos.y,
      text: `$/${uom}`,
      size: spec.size,
      weight: spec.weight ?? "B",
    },
  ];
}

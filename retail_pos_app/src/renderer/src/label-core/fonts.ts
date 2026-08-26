/**
 * The Korean faces this track prints with.
 *
 * These strings are the single source of truth for the renderer side. They must
 * stay identical to what `src/main/zpl-font/catalog.ts` installs — that module
 * pushes `NOTOKRM` / `NOTOKRB` / `NOTOKRBK` as `.TTF` objects onto the printer's
 * `E:` flash drive, and `^A@` addresses them by that exact drive+filename. A
 * mismatch here does not error: the printer silently prints nothing for the
 * field, which is why the pairing is spelled out rather than derived.
 */

export type FontWeight = "M" | "B" | "BK";

export const FONT: Record<FontWeight, string> = {
  M: "E:NOTOKRM.TTF",
  B: "E:NOTOKRB.TTF",
  BK: "E:NOTOKRBK.TTF",
};

export const FONT_WEIGHTS: FontWeight[] = ["M", "B", "BK"];

export const DEFAULT_WEIGHT: FontWeight = "M";

/**
 * The printer's own scalable font, selected with `^A0N`.
 *
 * ASCII only — a hangul field pointed at this comes out blank or as boxes. It
 * exists for captions that must still print when the TTF install has not
 * happened yet (the same trick `proofLabel` uses to label a failed row).
 */
export const BUILTIN_FONT = "0";

/**
 * Advance width as a fraction of the cell height, for `^A@N,h,w`.
 *
 * Noto Sans KR is drawn slightly narrow; passing `w = h` stretches Latin text.
 * 0.9 matches the face closely enough that the ^FB block width and the printed
 * text agree.
 */
export const FONT_WIDTH_RATIO = 0.9;

export function fontFile(weight: FontWeight = DEFAULT_WEIGHT): string {
  const file = FONT[weight];
  if (!file) throw new Error(`unknown font weight ${JSON.stringify(weight)}`);
  return file;
}

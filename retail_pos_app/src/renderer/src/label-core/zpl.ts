/**
 * The ZPL emitter — the only module in this library that knows the language.
 *
 * One format per label: `^XA` … `^XZ`, with `^CI28` first so every `^FD` after
 * it is read as UTF-8, and `^LH0,0` so element coordinates mean what they say
 * regardless of what the previous job left set. Text fields are always written
 * `^FH^FD…` because hangul reaches the printer through `escape.ts`, which uses
 * the `_` hex introducer.
 *
 * SLCS is gone. Bixolon XD3/XD5 accept `~DY` font download and `^A@` exactly as
 * Zebra does (verified on real hardware), so there is one dialect to emit and
 * one set of coordinates to tune.
 */

import { fieldData } from "./escape";
import { BUILTIN_FONT, DEFAULT_WEIGHT, FONT_WIDTH_RATIO, fontFile } from "./fonts";
import { getMedia } from "./media";
import type { Element, Label, Text } from "./model";
import {
  DEFAULT_MIN_TEXT_SIZE,
  estimateBarcodeWidth,
  estimateDataMatrixSize,
  estimateQrSize,
  fitSize,
  textWidth,
  utf8Length,
} from "./measure";

// Lives in `measure.ts` now — the clip guard in `templates/scale-6040.ts` has to
// resolve a size exactly the way `resolveTextSize` does, and templates may not
// import the emitter. Re-exported so the old import path still works.
export { DEFAULT_MIN_TEXT_SIZE };

/** Narrow-bar width when a barcode does not name one. */
export const DEFAULT_BARCODE_MODULE = 2;

/** Wide-to-narrow ratio for ^BY. Ignored by Code 128 and EAN, but ^BY wants it. */
const BARCODE_RATIO = 3;

/**
 * Dots the human-readable line adds under a barcode.
 *
 * The printer draws it in whatever `^CF` font is current, so this is the
 * observed height of the default rather than something we set.
 */
export const HRI_HEIGHT = 30;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The size a text element actually prints at.
 *
 * Shrinking needs a block width to shrink against, so a `shrink` without
 * `width` is a no-op rather than an error — the template simply did not say
 * what to fit into. For a wrapping block the budget is `width * lines`: the
 * text is allowed to use every line it was given, otherwise a three-line
 * paragraph would be shrunk as though it had to fit on one.
 */
export function resolveTextSize(el: Text): number {
  if (!el.shrink || !el.width) return Math.round(el.size);
  const budget = el.width * Math.max(1, el.lines ?? 1);
  return fitSize(el.text, budget, el.size, el.minSize ?? DEFAULT_MIN_TEXT_SIZE);
}

/**
 * Where an element lands, near enough for a debug outline.
 *
 * Barcode and 2D-symbol widths are estimates (see `measure.ts`); text is exact
 * when the element declares a block width and estimated otherwise. Nothing the
 * printer is told depends on these numbers — they only draw the dbg boxes and
 * let templates pack a row.
 */
export function elementBounds(el: Element): Rect {
  switch (el.kind) {
    case "text": {
      const size = resolveTextSize(el);
      const lines = Math.max(1, el.lines ?? 1);
      return {
        x: el.x,
        y: el.y,
        w: el.width ?? textWidth(el.text, size),
        h: size * lines,
      };
    }
    case "line":
    case "box":
      return {
        x: el.x,
        y: el.y,
        w: Math.max(el.w, el.thick),
        h: Math.max(el.h, el.thick),
      };
    case "barcode": {
      const module = el.module ?? DEFAULT_BARCODE_MODULE;
      const hri = el.hri ?? true;
      return {
        x: el.x,
        y: el.y,
        w: estimateBarcodeWidth(el.sym, el.data, module),
        h: el.h + (hri ? HRI_HEIGHT : 0),
      };
    }
    case "qr": {
      // A bottom-anchored symbol's top edge is *derived* from its size, so that
      // one needs the real payload-aware estimate — get it wrong and the box
      // the template packs against is in the wrong place. A top-anchored symbol
      // has an exact x/y and only an approximate width, and the layouts using
      // one were tuned against the v3 assumption, so it keeps that.
      if (el.anchor === "bottom") {
        const side = estimateQrSize(el.mag, utf8Length(el.data));
        return { x: el.x, y: el.y - side, w: side, h: side };
      }
      const side = estimateQrSize(el.mag);
      return { x: el.x, y: el.y, w: side, h: side };
    }
    case "datamatrix": {
      const side = estimateDataMatrixSize(el.size);
      return { x: el.x, y: el.y, w: side, h: side };
    }
  }
}

function renderText(el: Text): string {
  const size = resolveTextSize(el);
  const width = Math.round(size * FONT_WIDTH_RATIO);
  const font =
    el.font === "builtin"
      ? `^A${BUILTIN_FONT}N,${size},${width}`
      : `^A@N,${size},${width},${fontFile(el.weight ?? DEFAULT_WEIGHT)}`;

  // ^FB is what actually wraps and aligns; it is only meaningful with a width.
  const block = el.width
    ? `^FB${el.width},${Math.max(1, el.lines ?? 1)},0,${el.align ?? "L"},0`
    : "";

  return `^FO${el.x},${el.y}${font}${block}^FH^FD${fieldData(el.text)}^FS`;
}

function renderElement(el: Element): string {
  switch (el.kind) {
    case "text":
      return renderText(el);

    // A line is a box the caller made thinner than it is long; both are ^GB.
    case "line":
    case "box":
      return `^FO${el.x},${el.y}^GB${el.w},${el.h},${el.thick}^FS`;

    case "barcode": {
      const module = el.module ?? DEFAULT_BARCODE_MODULE;
      const hri = (el.hri ?? true) ? "Y" : "N";
      const by = `^BY${module},${BARCODE_RATIO},${el.h}`;
      // EAN-13 takes 12 digits — the thirteenth is the printer's check digit.
      const sym =
        el.sym === "ean13"
          ? `^BEN,${el.h},${hri},N`
          : `^BCN,${el.h},${hri},N,N`;
      return `^FO${el.x},${el.y}${by}${sym}^FH^FD${fieldData(el.data)}^FS`;
    }

    case "qr": {
      // Model 2, and the field data always starts `LA,`. Both halves of that
      // are hardware findings from a ZD421, not preferences:
      //
      //  * `A` is *automatic* input mode. Manual mode (`LM,B0147…`) picks
      //    alphanumeric encoding for a payload that looks alphanumeric, and
      //    QR's alphanumeric charset has no `"`, `[` or `]` — the printer
      //    silently dropped those characters out of a PP payload. Never send
      //    manual mode.
      //  * `L` is the level, and it is the only place the level is read from:
      //    this firmware ignores ^BQ's own error-correction parameter, so it is
      //    not emitted at all. `el.ec` is therefore documentation, not control.
      //
      // ^FT (field typeset) anchors the bottom-left corner and lets the symbol
      // grow upward; ^FO anchors the top-left. See `QrAnchor` for why that
      // matters for a symbol printed against a pre-printed rule.
      const at = el.anchor === "bottom" ? "^FT" : "^FO";
      return `${at}${el.x},${el.y}^BQN,2,${el.mag}^FH^FDLA,${fieldData(el.data)}^FS`;
    }

    case "datamatrix":
      // 200 = quality level 200 (ECC 200), the only one worth using.
      return `^FO${el.x},${el.y}^BXN,${el.size},200^FH^FD${fieldData(el.data)}^FS`;
  }
}

function dbgOutline(el: Element): string {
  const box = elementBounds(el);
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  return `^FO${Math.round(box.x)},${Math.round(box.y)}^GB${w},${h},1^FS`;
}

export function renderLabel(label: Label): string {
  const [width, height] = getMedia(label.media).dots;

  const out: string[] = ["^XA", "^CI28", `^PW${width}`, `^LL${height}`, "^LH0,0"];

  for (const el of label.elements) {
    out.push(renderElement(el));
    if (label.dbg) out.push(dbgOutline(el));
  }

  // ^PQ1 is the printer's default; emitting it would only add noise.
  if (label.copies && label.copies > 1) out.push(`^PQ${Math.round(label.copies)}`);

  out.push("^XZ");
  return out.join("\n");
}

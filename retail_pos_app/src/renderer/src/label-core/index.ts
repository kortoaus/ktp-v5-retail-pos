/**
 * label-core — the one label library.
 *
 * Pure TypeScript: no DOM, no node, no electron, no react, and no import that
 * leaves this directory. That is a hard constraint, not a preference — the same
 * files are to be copied verbatim into the operations app and the runner the
 * way `sync-sale-core` copies the sale maths, so anything platform-shaped here
 * would have to be reimplemented three times.
 *
 * Templates build a `Label` (declarative, integer dots, origin top-left);
 * `renderLabel` turns it into ZPL. Everything a caller needs is re-exported
 * here so consumers import from `label-core`, not from its internals.
 */

export { DPMM, MEDIA, MEDIA_IDS, getMedia, mmToDots } from "./media";
export type { Media, MediaId } from "./media";

export {
  BUILTIN_FONT,
  DEFAULT_WEIGHT,
  FONT,
  FONT_WEIGHTS,
  FONT_WIDTH_RATIO,
  fontFile,
} from "./fonts";
export type { FontWeight } from "./fonts";

export { STRIKE_THICK, strike } from "./model";
export type {
  Align,
  Barcode,
  BarcodeSymbology,
  Box,
  DataMatrix,
  Element,
  Label,
  Line,
  Qr,
  QrEc,
  Text,
} from "./model";

export {
  clamp,
  code128Modules,
  estimateBarcodeWidth,
  estimateDataMatrixSize,
  estimateQrSize,
  fitSize,
  textEm,
  textWidth,
} from "./measure";

export { fieldData } from "./escape";

export {
  DEFAULT_BARCODE_MODULE,
  DEFAULT_MIN_TEXT_SIZE,
  HRI_HEIGHT,
  elementBounds,
  renderLabel,
  resolveTextSize,
} from "./zpl";
export type { Rect } from "./zpl";

export { mergeJobs } from "./merge";

export {
  DIAGNOSTIC_CODE128,
  DIAGNOSTIC_DATAMATRIX,
  DIAGNOSTIC_EAN13,
  DIAGNOSTIC_QR,
  DIAGNOSTIC_SHRINK_TEXT,
  buildDiagnosticLabel,
} from "./diagnostic";
export type { DiagnosticOptions } from "./diagnostic";

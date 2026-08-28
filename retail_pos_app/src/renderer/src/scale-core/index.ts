/**
 * scale-core — the weighing maths, in one place.
 *
 * Pure TypeScript: no DOM, no node, no electron, no react, and no import that
 * leaves this directory — the same rules `label-core` lives by, and for the same
 * reason: these files are copied verbatim into `ktpv5-retail-runner`, where they
 * came from. **This copy is the canon; the runner's is the sync target.**
 *
 * Everything a caller needs is re-exported here, so consumers import from
 * `scale-core`, not from its internals. The `Item` → template-input mapping is
 * *not* here — an adapter knows about the app's model and lives with the screen
 * (`label-core/adapters/scale-label.ts`).
 */

export {
  MONEY_SCALE,
  PCT_SCALE,
  PRICE_LEVEL_COUNT,
  QTY_SCALE,
  applyAmtMarkdown,
  applyMarkdown,
  applyPctMarkdown,
  computeTotalCents,
  formatCentsToDollars,
  parseWeightGrams,
  resolveFacePrice,
} from "./weigh-pricing";
export type { MarkdownKind, ResolvedFacePrice } from "./weigh-pricing";

export { ean13CheckDigit, makeLabelData } from "./label-data";
export type {
  MakeLabelDataInput,
  ScaleLabelBarcodeFormat,
  ScaleLabelBarcodeMode,
  ScaleLabelData,
  ScaleLabelMarkdown,
} from "./label-data";

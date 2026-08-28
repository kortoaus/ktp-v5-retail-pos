/**
 * `/scale` station state → the two scale template inputs.
 *
 * ## What an adapter is, and why it lives here
 *
 * `label-core/` proper is portable — no DOM, no node, no electron, and no
 * import that leaves the directory — because those files are copied verbatim
 * into the operations app and the runner. Its templates therefore speak only
 * their own input types (`ScaleLabelInput`, `IngredientLabelInput`), and
 * something has to map this app's `Item` plus the weighing screen's editable
 * state onto them. That mapping is `adapters/`: app-facing on purpose, and
 * deliberately not re-exported from `label-core/index.ts`.
 *
 * The same split applies on the other side. All *money* and *barcode* maths
 * belongs to `scale-core/` (the canon; the runner's copy is a sync target), so
 * this file computes nothing — it calls `makeLabelData` once and then decides
 * which of its strings goes in which cell, prefixes the name, builds the PP
 * payload, and picks the symbol.
 *
 * ## The four lanes
 *
 * Owner-specified, and there is no PLU-only lane:
 *
 *   1D scale       → `buildScaleLabel6040`      + EAN-13, embedded price
 *   1D ingredient  → `buildIngredientLabel58100` + EAN-13, embedded price
 *   2D normal      → `buildScaleLabel6040`      + PP QR
 *   2D ingredient  → `buildIngredientLabel58100` + PP QR
 *
 * `lane` therefore only chooses the **symbol**; every text field is identical
 * across the four, which is what makes one adapter enough.
 *
 * ## Two barcode columns, two jobs
 *
 * - **1D** embeds the price after a 7-digit PLU (`02IIIII`), so it reads from
 *   `barcodePLU`, falling back to `barcode`. That is a deliberate departure
 *   from the runner's `useWeighItem`, which passes `item.barcode`: on this
 *   catalogue the 7-digit PLU lives in its own column, and the server's
 *   `getItemByBarcode` resolves a scanned `02IIIII…` through `getItemByPLU`.
 * - **2D** carries the item's identity in PP field `01`, which the sale screen
 *   feeds straight to `GET /api/item/search/barcode`. That resolver tries GTIN,
 *   then PLU, then raw — so the payload uses the widest identifier available,
 *   `barcodeGTIN || barcodePLU || barcode`.
 *
 * ## Runtime imports
 *
 * `dayjsAU`, `scale-core`, `libs/pp-barcode` and the sibling adapter's
 * `itemLabelNames` — all pure, so the colocated `*.test.mjs` runs this module
 * directly under `node --experimental-strip-types`. `Item` is a type-only
 * import and erases.
 */

import dayjsAU from "../../libs/dayjsAU";
import { buildPPBarcodeString } from "../../libs/pp-barcode";
import { makeLabelData } from "../../scale-core/label-data";
import type { ScaleLabelData, ScaleLabelMarkdown } from "../../scale-core/label-data";
import { MONEY_SCALE, PCT_SCALE } from "../../scale-core/weigh-pricing";
import type { Item } from "../../types/models";
import type { IngredientLabelInput } from "../templates/ingredient-58100";
import type { ScaleBarcode, ScaleLabelInput } from "../templates/scale-6040";
import { itemLabelNames } from "./item-price-tag";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
//
// The data spec is ISO `YYYY-MM-DD` everywhere — the station's state, PP field
// `07`, and both templates' `packedOnIso`/`usedByIso`. A display format is
// never stored, only rendered, which is the lesson the legacy `07` field bug
// left behind. `formatLabelDate` exists for the screen, not for the label:
// the templates format their own dates (`formatScaleDates`).

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Today in Sydney, ISO. Business time is `Australia/Sydney` fleet-wide, and
 * `dayjsAU` is the renderer's only date entry point — never `new Date()`
 * where a business-day boundary is involved.
 */
export function sydneyTodayIso(now?: Date): string {
  return dayjsAU(now).format("YYYY-MM-DD");
}

/**
 * An ISO date plus whole calendar days.
 *
 * Deliberately *not* `dayjsAU(iso).add(days)`: an ISO date has no time, so
 * handing it to a timezone-converting constructor makes the answer depend on
 * the machine's own zone. Anchoring at UTC noon and doing plain calendar
 * arithmetic gives the same result on any terminal and across any DST edge.
 *
 * Malformed input is returned unchanged — a weighing screen that throws on a
 * bad date is worse than one that shows the bad date.
 */
export function addDaysIso(iso: string, days: number): string {
  const m = ISO_DATE.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days, 12));
  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Display only: `"2026-08-21"` → `"21 Aug 26"`, for the screen.
 *
 * Not for a label — both templates format their own dates (`formatScaleDates`),
 * because how a date is rendered on 60 × 40 stock is a layout decision. Same
 * zone-independence as `addDaysIso`; malformed input passes through.
 */
export function formatLabelDate(iso: string): string {
  const m = ISO_DATE.exec(iso);
  if (!m) return iso;
  const month = MONTHS_EN[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])} ${month} ${m[1].slice(2)}`;
}

// ---------------------------------------------------------------------------
// The station's state
// ---------------------------------------------------------------------------

/** Which symbol the label carries. Every text field is the same either way. */
export type ScaleLabelLane = "1d" | "2d";

/** The store block the 60 × 40 footer prints. The 58 × 100 stock pre-prints it. */
export interface ScaleLabelStore {
  name?: string | null;
  address?: string | null;
}

/**
 * Everything the weighing screen holds that a label depends on.
 *
 * `prices`/`promoPrices` are **level arrays at the length they arrived with**,
 * after any manual override — never a single number. The 2D payload has to
 * carry them through unfolded (`label-data.ts`'s PP invariant), so collapsing
 * them to one price here would be the double-discount bug one layer up.
 */
export interface ScaleLabelState {
  item: Item;
  /** The scale reader's weight string — five padded grams, `"01036"`. */
  weight: string;
  prices: number[] | null;
  promoPrices: number[] | null;
  /** pct is permill (10% = 100), amt is cents. Null, or a value ≤ 0, means none. */
  markdown: ScaleLabelMarkdown | null;
  packedOnIso: string;
  usedByOffsetDays: number;
}

// ---------------------------------------------------------------------------
// Item fields
// ---------------------------------------------------------------------------

/** A weighed item takes its weight from the platter; a fixed one never does. */
export function isWeighedItem(item: Item): boolean {
  return item.scaleData ? !item.scaleData.isFixedWeight : false;
}

/**
 * The NET cell for a fixed-weight item.
 *
 * `fixedWeightString` when the catalogue has one. Otherwise `1 EA`-style text,
 * because the pre-printed cell says `NET kg` and a bare `1` under it would read
 * as a kilogram. A weighed item never reaches this — `makeLabelData` prints its
 * measured kilograms instead.
 */
export function fixedWeightText(item: Item): string {
  const fixed = item.scaleData?.fixedWeightString?.trim();
  if (fixed) return fixed;
  const uom = item.uom?.trim();
  return uom ? `1 ${uom.toUpperCase()}` : "1 EA";
}

/**
 * The unit printed over the money column.
 *
 * A weighed item is always `kg` — the platter reads kilograms whatever the
 * catalogue's `uom` says. Anything else keeps its own unit, and both templates
 * rule out the pre-printed `$/KG` caption and reprint it (`uomOverride`).
 */
export function labelUnit(item: Item): string {
  return isWeighedItem(item) ? "kg" : item.uom?.trim() || "ea";
}

/** 1D lane identity: the 7-digit PLU the embedded price is appended to. */
export function embeddedPriceBarcode(item: Item): string {
  return item.barcodePLU?.trim() || item.barcode?.trim() || "";
}

/** 2D lane identity: PP field `01`, widest first — the till's resolver order. */
export function ppPayloadBarcode(item: Item): string {
  return (
    item.barcodeGTIN?.trim() ||
    item.barcodePLU?.trim() ||
    item.barcode?.trim() ||
    ""
  );
}

// ---------------------------------------------------------------------------
// Markdown name tag
// ---------------------------------------------------------------------------

/**
 * The legacy scale convention: a markdown is announced by a tag **prepended to
 * the name**, not by a field of its own. Neither template builds or strips one
 * — they only measure what they are given — so it is built here.
 *
 * `300` permill prints as `30%`, not `30.0%`; a fractional permill keeps one
 * decimal (`305` → `30.5%`).
 */
export function markdownNameTag(markdown: ScaleLabelMarkdown | null): string {
  if (!markdown || markdown.value <= 0) return "";
  if (markdown.type === "pct") {
    const percent = (markdown.value / (PCT_SCALE / 100)).toFixed(1).replace(/\.0$/, "");
    return `[${percent}% OFF] `;
  }
  return `[$${(markdown.value / MONEY_SCALE).toFixed(2)} OFF] `;
}

// ---------------------------------------------------------------------------
// Label data
// ---------------------------------------------------------------------------

/**
 * The station's state through `scale-core`.
 *
 * Returns a `ScaleLabelData`, or the legacy **reason string** when no label can
 * be made — no price, nothing on the platter, no 7-digit PLU, or a total past
 * the embedded price's $999.99 ceiling. The screen shows that reason where the
 * barcode preview goes and disables every print button.
 *
 * `embeddedPrice` mode is used for **both** lanes, so the two are never out of
 * step about what the item costs. It does mean an item with no 7-digit PLU
 * blocks the 2D lane as well, even though its QR would not have needed one —
 * loud rather than silent, and a catalogue problem, not a layout one.
 */
export function buildScaleLabelData(state: ScaleLabelState): ScaleLabelData | string {
  const { item } = state;
  const isWeighed = isWeighedItem(item);
  const packedOnIso = state.packedOnIso;
  const usedByIso = addDaysIso(packedOnIso, state.usedByOffsetDays);

  return makeLabelData({
    name_en: item.name_en,
    prices: state.prices,
    promoPrices: state.promoPrices,
    weight: state.weight,
    is_weight: isWeighed,
    fixed_net_weight: fixedWeightText(item),
    packedOnDisplay: formatLabelDate(packedOnIso),
    usedByDisplay: formatLabelDate(usedByIso),
    packedOnIso,
    usedByOffsetDays: state.usedByOffsetDays,
    barcode: embeddedPriceBarcode(item),
    unit: labelUnit(item),
    ingredients: item.scaleData?.ingredients ?? "",
    markdown: state.markdown,
  });
}

/**
 * The PP payload for the 2D lanes.
 *
 * `02`/`03` carry the **unfolded** level arrays and `05`/`06` carry the
 * markdown, exactly as `label-data.ts` hands them over — folding a markdown
 * into `02`/`03` while also emitting `05`/`06` discounts the item twice at the
 * till. `07` is ISO and `08` is a whole-day offset, which is what the sale
 * screen's `parsePPBarcode` reads.
 */
export function buildScalePPPayload(
  state: ScaleLabelState,
  label: ScaleLabelData,
): string {
  const weighed = isWeighedItem(state.item);
  const weightGrams = Number.parseInt(state.weight, 10);

  return buildPPBarcodeString({
    barcode: ppPayloadBarcode(state.item),
    prices: label.pricesRaw ?? [],
    promoPrices: label.promoPricesRaw ?? [],
    weight: weighed && Number.isFinite(weightGrams) && weightGrams > 0 ? weightGrams : null,
    discountType: label.markdown?.type ?? null,
    discountAmount: label.markdown?.value ?? 0,
    packedOn: label.packedOnIso,
    usedBy: label.usedByOffsetDays,
  });
}

/** The one symbol the chosen lane puts in the template's empty zone. */
export function scaleBarcodeFor(
  lane: ScaleLabelLane,
  state: ScaleLabelState,
  label: ScaleLabelData,
): ScaleBarcode {
  return lane === "1d"
    ? { kind: "ean13", data12: label.barcode }
    : { kind: "pp", qrData: buildScalePPPayload(state, label) };
}

// ---------------------------------------------------------------------------
// Template inputs
// ---------------------------------------------------------------------------

/**
 * The 60 × 40 scale label's input.
 *
 * Money goes in with a leading `$`: the 60 × 40 prints `unitPriceText`
 * verbatim into a cell whose caption is `$/kg`, while every other money field
 * on both templates runs through `amountOnly`, which strips the sign the
 * pre-printed artwork already carries. One convention, safe on both sides.
 *
 * `nameKo` is populated even though neither template prints it — the shared
 * input type carries it, and a future template may want it.
 */
export function toScaleLabel6040Input(
  state: ScaleLabelState,
  label: ScaleLabelData,
  lane: ScaleLabelLane,
  store: ScaleLabelStore = {},
): ScaleLabelInput {
  const names = itemLabelNames(state.item);
  const tag = markdownNameTag(label.markdown);

  return {
    nameKo: names.nameKo,
    nameEn: `${tag}${names.nameEn}`,
    packedOnIso: state.packedOnIso,
    usedByIso: addDaysIso(state.packedOnIso, state.usedByOffsetDays),
    weightText: label.weight,
    unit: label.unit,
    unitPriceText: `$${label.unitPrice}`,
    wasUnitPriceText: label.wasPrice ? `$${label.wasPrice}` : null,
    totalText: `$${label.totalPrice}`,
    wasTotalText: label.wasTotalPrice ? `$${label.wasTotalPrice}` : null,
    barcode: scaleBarcodeFor(lane, state, label),
    storeName: store.name ?? null,
    storeAddress: store.address ?? null,
  };
}

/**
 * The 58 × 100 ingredient label's input — the 60 × 40's, plus the statement
 * panel. The store block is dropped: that stock pre-prints the store in its
 * yellow header and footer, so passing it would double it.
 */
export function toIngredientLabel58100Input(
  state: ScaleLabelState,
  label: ScaleLabelData,
  lane: ScaleLabelLane,
): IngredientLabelInput {
  return {
    ...toScaleLabel6040Input(state, label, lane),
    storeName: null,
    storeAddress: null,
    ingredients: label.ingredients || null,
  };
}

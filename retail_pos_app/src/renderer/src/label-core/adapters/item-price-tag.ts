/**
 * POS `Item` → price-tag template input.
 *
 * ## What an adapter is, and why it lives here rather than in `label-core/`
 *
 * `label-core/` proper is portable: no DOM, no node, no electron, and no import
 * that leaves the directory, because those files are copied verbatim into the
 * operations app and the runner. Its templates therefore speak only their own
 * input types — `PriceTagInput`, `PriceTag7090Input` — and something has to map
 * this app's `Item` record onto them.
 *
 * That mapping is `adapters/`. It is app-facing on purpose: it knows about
 * `Item`, about `Australia/Sydney`, about which of the three barcode columns a
 * tag prints. It is **not** part of the portable set and is deliberately not
 * re-exported from `label-core/index.ts` — a repo that copies the library
 * writes its own adapter over its own model.
 *
 * ## Where the rules came from
 *
 * Every branch below is ported from the two legacy builders this replaces:
 *
 *   - `libs/label-templates.ts buildPriceTag7030` — the 70 × 30 tag.
 *   - `libs/label-7090-v2/price-model.ts getPriceTag7090Model` — the 70 × 90
 *     tag's promo/member branching, which is the richer of the two.
 *
 * The two disagreed in three places (promo detection, guest-price clamping,
 * which barcode column prints). Where they disagreed on *pricing* this file
 * follows the 7090 rule for both tags — see `resolveItemPricing` — because the
 * two tags now share `shouldPrint7090` as a router and must agree about whether
 * an item is on promotion. The barcode disagreement is preserved, deliberately;
 * see `priceTag7030Barcode`.
 *
 * ## Runtime imports
 *
 * `dayjsAU` only, so the colocated `*.test.mjs` can run this module directly
 * under `node --experimental-strip-types` (`npm run test:label-core`). `Item` is
 * a type-only import and erases. `libs/item-utils.ts itemNameParser` is *not*
 * imported for that reason — it drags `service/item.service` → axios in behind
 * a dead `embededPriceParser` import — so its rule is restated as
 * `itemLabelNames` below. Keep the two in step.
 */

import dayjsAU from "../../libs/dayjsAU";
import type { Item } from "../../types/models";
import type { PriceTagInput } from "../templates/price-tag-7030";
import type {
  PriceTag7090Input,
  PriceTag7090Mode,
} from "../templates/price-tag-7090";

/** What the screen knows and the item record does not. */
export interface PriceTagContext {
  /** `current` prints today's promotion, `normal` the shelf price. Default `current`. */
  mode?: PriceTag7090Mode;
  /** Headline for a non-promotional 70 × 90 tag. Ignored by the 70 × 30 tag. */
  storeName?: string | null;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export interface ItemLabelNames {
  nameKo: string;
  nameEn: string;
}

/**
 * The brand-prefixed display names, as `libs/item-utils.ts itemNameParser`
 * builds them: a non-blank brand name is prepended in square brackets, in its
 * own language, and a blank one contributes nothing — not even the brackets.
 *
 * Restated here rather than imported; see the module header for why. If
 * `itemNameParser` changes, change this with it.
 */
export function itemLabelNames(item: Item): ItemLabelNames {
  const brand = item.brand;
  const brandEn = brand && brand.name_en.trim() ? `[${brand.name_en}] ` : "";
  const brandKo = brand && brand.name_ko.trim() ? `[${brand.name_ko}] ` : "";
  return {
    nameEn: `${brandEn}${item.name_en}`,
    nameKo: `${brandKo}${item.name_ko}`,
  };
}

// ---------------------------------------------------------------------------
// Barcodes
// ---------------------------------------------------------------------------

/**
 * What the 70 × 30 tag prints and encodes: the raw `barcode` column.
 *
 * The legacy 70 × 30 builder used `item.barcode` while the 70 × 90 one used
 * `barcodeGTIN || barcodePLU || barcode`, and the difference is real — the
 * local server derives `barcodeGTIN` by normalising `barcode` to GTIN-14 on
 * down-sync (`cloud.migrate.service.ts getNormalizedBarcode`), so a 13-digit
 * EAN prints as itself on the small tag and zero-padded to 14 on the big one.
 *
 * Both behaviours are preserved as they shipped rather than unified on a guess:
 * which one staff actually scan against is a question for the owner, not for
 * this port.
 */
export function priceTag7030Barcode(item: Item): string {
  return item.barcode;
}

/** What the 70 × 90 tag prints and encodes — see `priceTag7030Barcode`. */
export function priceTag7090Barcode(item: Item): string {
  return item.barcodeGTIN || item.barcodePLU || item.barcode;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * A promotion window as the tags print it: `26/08 - 27/08`.
 *
 * Not `libs/dayjsAU.ts fmtDateRangeStr`, which the legacy builders used and
 * which produces `26th-27th Aug 26`. The templates were tuned on hardware
 * against the short numeric form (see `price-tag-7030.ts`'s footer), and the
 * owner confirmed it — the long form does not fit the 70 × 30 footer beside the
 * was-price without shrinking both to unreadable.
 */
export function formatPromoRange(from: string, to: string): string {
  return `${dayjsAU(from).format("DD/MM")} - ${dayjsAU(to).format("DD/MM")}`;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

function positivePrice(value: number | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

/**
 * A member price only counts when it beats what a guest pays.
 *
 * Straight from `price-model.ts`: a "member price" equal to the shelf price is
 * worse than none at all, because it tells the shopper the card is worthless.
 */
function memberPrice(guestCents: number, value: number | undefined): number | null {
  const cents = positivePrice(value);
  return cents !== null && cents < guestCents ? cents : null;
}

export interface ItemPricing {
  /** The shelf price — what `Was …` refers to. */
  baseCents: number;
  /** What a guest pays today. */
  guestCents: number;
  /** What a member pays, when that beats the guest price. */
  memberCents: number | null;
  isPromo: boolean;
  promoName: string | null;
  promoRange: string | null;
}

/**
 * The whole price branching, ported from `price-model.ts` and applied to both
 * tags.
 *
 * Three deliberate departures from the *70 × 30* legacy builder, which was the
 * looser of the two:
 *
 *   1. **A promotion needs a positive promo price.** The old 70 × 30 builder
 *      treated any non-null `promoPrice` row as a promotion and charged
 *      `prices[0] ?? 0`, so a row with a missing or zero price printed a
 *      `$0.00` shelf tag. `positivePrice` is the 70 × 90 rule and it wins.
 *   2. **The promo price is clamped to the shelf price.** `Math.min` is again
 *      the 70 × 90 rule: a "promotion" dearer than the shelf price is a data
 *      error, and printing it would put a `Was $x` under a higher number.
 *   3. **`mode: "normal"` suppresses the promotion** on the small tag too. The
 *      old builder had no mode at all; nothing calls the 70 × 30 path with
 *      `normal` today, so this only widens what is expressible.
 *
 * Note what is *kept* from the legacy: when a promotion is running, the member
 * price comes from the **promo** row only. An item whose promo row carries no
 * member price prints no member price, even if the normal row has one that
 * still beats the promo guest price. That is how both builders behaved.
 */
export function resolveItemPricing(
  item: Item,
  mode: PriceTag7090Mode = "current",
): ItemPricing {
  const baseCents = item.price?.prices[0] ?? 0;
  const promo = mode !== "normal" ? item.promoPrice : null;
  const promoCents = promo !== null ? positivePrice(promo.prices[0]) : null;

  if (promo !== null && promoCents !== null) {
    const guestCents = Math.min(baseCents, promoCents);
    return {
      baseCents,
      guestCents,
      memberCents: memberPrice(guestCents, promo.prices[1]),
      isPromo: true,
      promoName: promo.name_en.trim() || null,
      promoRange: formatPromoRange(promo.validFrom, promo.validTo),
    };
  }

  return {
    baseCents,
    guestCents: baseCents,
    memberCents: memberPrice(baseCents, item.price?.prices[1]),
    isPromo: false,
    promoName: null,
    promoRange: null,
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Does this item want the big tag?
 *
 * The rule the item-sheet screen has always used
 * (`PrintItemPriceTagSheet.tsx`, pre-port): anything with a promotion, or with
 * a member price that actually beats the guest price, has more to say than a
 * 70 × 30 tag can hold. It lives here so the sheet and the manual tab route the
 * same way; whether a 70 × 90 printer is even configured stays a call-site
 * question.
 *
 * Note this reads the raw `promoPrice` row rather than `resolveItemPricing`,
 * exactly as the original did: an item with a malformed promo row still gets
 * the roomier tag, which is the safer direction to be wrong in.
 */
export function shouldPrint7090(item: Item): boolean {
  if (item.promoPrice != null) return true;

  const guestCents = item.price?.prices[0];
  const memberCents = item.price?.prices[1];

  return (
    typeof guestCents === "number" &&
    typeof memberCents === "number" &&
    memberCents > 0 &&
    memberCents < guestCents
  );
}

// ---------------------------------------------------------------------------
// The adapters
// ---------------------------------------------------------------------------

/**
 * `Item` → 70 × 30 shelf tag.
 *
 * `wasPriceCents` is null when there is no promotion rather than a copy of the
 * price: the template's own rule is that a was-price not higher than what is
 * charged is not a promotion, and handing it one would be asking it to decide
 * something already decided here.
 */
export function toPriceTag7030Input(
  item: Item,
  ctx: PriceTagContext = {},
): PriceTagInput {
  const pricing = resolveItemPricing(item, ctx.mode ?? "current");
  const { nameKo, nameEn } = itemLabelNames(item);

  return {
    nameKo,
    nameEn,
    uom: item.uom,
    priceCents: pricing.guestCents,
    wasPriceCents: pricing.isPromo ? pricing.baseCents : null,
    promoRange: pricing.promoRange,
    barcode: priceTag7030Barcode(item),
  };
}

/**
 * `Item` → 70 × 90 shelf tag.
 *
 * `mode` is passed through rather than resolved away, because the template
 * re-derives its four cases from the same three numbers and the mode is one of
 * its inputs; suppressing the promotion here *and* there would be two places to
 * get it wrong.
 */
export function toPriceTag7090Input(
  item: Item,
  ctx: PriceTagContext = {},
): PriceTag7090Input {
  const mode = ctx.mode ?? "current";
  const pricing = resolveItemPricing(item, mode);
  const { nameKo, nameEn } = itemLabelNames(item);

  return {
    nameKo,
    nameEn,
    uom: item.uom,
    priceCents: pricing.guestCents,
    wasPriceCents: pricing.isPromo ? pricing.baseCents : null,
    promoRange: pricing.promoRange,
    barcode: priceTag7090Barcode(item),
    memberPriceCents: pricing.memberCents,
    promoName: pricing.promoName,
    storeName: ctx.storeName ?? null,
    mode,
  };
}

// npm run test:label-core
//
// The port's contract with the two legacy builders it replaces. Every case
// below is a rule one of them had (or, where they disagreed, the one this
// adapter chose) — see `item-price-tag.ts`'s header for the three deliberate
// departures from the 70 × 30 builder.
import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPromoRange,
  itemLabelNames,
  priceTag7030Barcode,
  priceTag7090Barcode,
  resolveItemPricing,
  shouldPrint7090,
  toPriceTag7030Input,
  toPriceTag7090Input,
} from "./item-price-tag.ts";
import { buildPriceTag7030 } from "../templates/price-tag-7030.ts";
import { buildPriceTag7090 } from "../templates/price-tag-7090.ts";
import { renderLabel } from "../zpl.ts";

/** August is AEST (+10), so these instants are unambiguous in Sydney. */
const FROM = "2026-08-25T14:00:00.000Z"; // 26/08 00:00 Sydney
const TO = "2026-08-27T02:00:00.000Z"; //   27/08 12:00 Sydney

const ITEM = {
  name_en: "Shrimp Cracker",
  name_ko: "새우깡",
  uom: "ea",
  barcode: "8801043015681",
  barcodeGTIN: null,
  barcodePLU: null,
  brand: null,
  price: { prices: [6200] },
  promoPrice: null,
};

const promoRow = (over = {}) => ({
  prices: [5500],
  validFrom: FROM,
  validTo: TO,
  name_en: "Special",
  name_ko: "특가",
  ...over,
});

// ── names ──────────────────────────────────────────────────────────────────

test("itemLabelNames leaves a brandless item alone", () => {
  assert.deepEqual(itemLabelNames(ITEM), {
    nameEn: "Shrimp Cracker",
    nameKo: "새우깡",
  });
});

test("itemLabelNames prefixes the brand in its own language", () => {
  const item = { ...ITEM, brand: { name_en: "Nongshim", name_ko: "농심" } };
  assert.deepEqual(itemLabelNames(item), {
    nameEn: "[Nongshim] Shrimp Cracker",
    nameKo: "[농심] 새우깡",
  });
});

test("itemLabelNames drops the brackets for a blank brand name", () => {
  const item = { ...ITEM, brand: { name_en: "  ", name_ko: "농심" } };
  assert.deepEqual(itemLabelNames(item), {
    nameEn: "Shrimp Cracker",
    nameKo: "[농심] 새우깡",
  });
});

// ── barcodes ───────────────────────────────────────────────────────────────

test("the two tags read different barcode columns, as they always did", () => {
  const item = { ...ITEM, barcodeGTIN: "08801043015681", barcodePLU: "1234" };
  assert.equal(priceTag7030Barcode(item), "8801043015681");
  assert.equal(priceTag7090Barcode(item), "08801043015681");
});

test("the 70x90 barcode falls back GTIN -> PLU -> barcode", () => {
  assert.equal(
    priceTag7090Barcode({ ...ITEM, barcodeGTIN: null, barcodePLU: "1234" }),
    "1234",
  );
  assert.equal(priceTag7090Barcode(ITEM), "8801043015681");
});

// ── dates ──────────────────────────────────────────────────────────────────

test("formatPromoRange is DD/MM - DD/MM in Sydney time", () => {
  assert.equal(formatPromoRange(FROM, TO), "26/08 - 27/08");
});

// ── pricing ────────────────────────────────────────────────────────────────

test("no promo, no member price: the shelf price stands alone", () => {
  assert.deepEqual(resolveItemPricing(ITEM), {
    baseCents: 6200,
    guestCents: 6200,
    memberCents: null,
    isPromo: false,
    promoName: null,
    promoRange: null,
  });
});

test("a member price counts only when it beats the guest price", () => {
  const member = (cents) =>
    resolveItemPricing({ ...ITEM, price: { prices: [6200, cents] } }).memberCents;
  assert.equal(member(5900), 5900);
  assert.equal(member(6200), null, "equal to guest is no member price");
  assert.equal(member(6500), null, "dearer than guest is no member price");
  assert.equal(member(0), null, "zero is no member price");
});

test("a promotion becomes the guest price, with the shelf price as the base", () => {
  const pricing = resolveItemPricing({ ...ITEM, promoPrice: promoRow() });
  assert.deepEqual(pricing, {
    baseCents: 6200,
    guestCents: 5500,
    memberCents: null,
    isPromo: true,
    promoName: "Special",
    promoRange: "26/08 - 27/08",
  });
});

test("while a promotion runs, the member price comes from the promo row only", () => {
  const item = {
    ...ITEM,
    price: { prices: [6200, 5900] },
    promoPrice: promoRow({ prices: [5500, 4990] }),
  };
  assert.equal(resolveItemPricing(item).memberCents, 4990);

  // 5900 still beats the 5500 promo guest price, but the promo row carries no
  // member price — so neither did the legacy builders print one.
  const noPromoMember = { ...item, promoPrice: promoRow({ prices: [5500] }) };
  assert.equal(resolveItemPricing(noPromoMember).memberCents, null);
});

test("a promo row without a positive price is not a promotion", () => {
  for (const prices of [[0], [], [-1]]) {
    const pricing = resolveItemPricing({ ...ITEM, promoPrice: promoRow({ prices }) });
    assert.equal(pricing.isPromo, false, JSON.stringify(prices));
    assert.equal(pricing.guestCents, 6200);
  }
});

test("a promo price dearer than the shelf price is clamped, not printed", () => {
  const pricing = resolveItemPricing({
    ...ITEM,
    promoPrice: promoRow({ prices: [9900] }),
  });
  assert.equal(pricing.guestCents, 6200);
  // The template then sees priceCents === wasPriceCents and draws a normal tag:
  // there is nothing to promote. Documented here because the legacy 70x90
  // builder still called this a promo tag.
  assert.equal(pricing.isPromo, true);
});

test("mode normal suppresses the promotion on both tags", () => {
  const item = { ...ITEM, promoPrice: promoRow() };
  const pricing = resolveItemPricing(item, "normal");
  assert.equal(pricing.isPromo, false);
  assert.equal(pricing.guestCents, 6200);
  assert.equal(pricing.promoRange, null);
});

test("a blank promo name leaves the headline to the template", () => {
  const item = { ...ITEM, promoPrice: promoRow({ name_en: "   " }) };
  assert.equal(resolveItemPricing(item).promoName, null);
});

// ── routing ────────────────────────────────────────────────────────────────

test("shouldPrint7090 sends promotions and real member prices to the big tag", () => {
  assert.equal(shouldPrint7090(ITEM), false);
  assert.equal(shouldPrint7090({ ...ITEM, promoPrice: promoRow() }), true);
  assert.equal(
    shouldPrint7090({ ...ITEM, price: { prices: [6200, 5900] } }),
    true,
  );
  assert.equal(
    shouldPrint7090({ ...ITEM, price: { prices: [6200, 6200] } }),
    false,
  );
});

test("shouldPrint7090 trusts the promo row even when it is malformed", () => {
  // The roomier tag is the safer direction to be wrong in — the original rule.
  assert.equal(shouldPrint7090({ ...ITEM, promoPrice: promoRow({ prices: [0] }) }), true);
});

// ── the adapters themselves ────────────────────────────────────────────────

test("toPriceTag7030Input maps a promotional item", () => {
  const item = {
    ...ITEM,
    brand: { name_en: "Nongshim", name_ko: "농심" },
    promoPrice: promoRow(),
  };
  assert.deepEqual(toPriceTag7030Input(item), {
    nameKo: "[농심] 새우깡",
    nameEn: "[Nongshim] Shrimp Cracker",
    uom: "ea",
    priceCents: 5500,
    wasPriceCents: 6200,
    promoRange: "26/08 - 27/08",
    barcode: "8801043015681",
  });
});

test("toPriceTag7030Input leaves wasPriceCents null when nothing is on promo", () => {
  const input = toPriceTag7030Input(ITEM);
  assert.equal(input.wasPriceCents, null);
  assert.equal(input.promoRange, null);
  assert.equal(input.priceCents, 6200);
});

test("toPriceTag7090Input carries the member price, headline and mode", () => {
  const item = {
    ...ITEM,
    price: { prices: [6200, 5900] },
    promoPrice: promoRow({ prices: [5500, 4990] }),
    barcodeGTIN: "08801043015681",
  };
  assert.deepEqual(toPriceTag7090Input(item, { storeName: "KTP Mart" }), {
    nameKo: "새우깡",
    nameEn: "Shrimp Cracker",
    uom: "ea",
    priceCents: 5500,
    wasPriceCents: 6200,
    promoRange: "26/08 - 27/08",
    barcode: "08801043015681",
    memberPriceCents: 4990,
    promoName: "Special",
    storeName: "KTP Mart",
    mode: "current",
  });
});

test("toPriceTag7090Input in normal mode prints the shelf tag", () => {
  const item = { ...ITEM, price: { prices: [6200, 5900] }, promoPrice: promoRow() };
  const input = toPriceTag7090Input(item, { mode: "normal", storeName: "KTP Mart" });
  assert.equal(input.mode, "normal");
  assert.equal(input.priceCents, 6200);
  assert.equal(input.wasPriceCents, null);
  assert.equal(input.memberPriceCents, 5900, "the normal member price returns");
});

// ── end to end ─────────────────────────────────────────────────────────────

test("both tags render to ZPL that carries the Korean name", () => {
  const item = {
    ...ITEM,
    brand: { name_en: "Nongshim", name_ko: "농심" },
    price: { prices: [6200, 5900] },
    promoPrice: promoRow({ prices: [5500, 4990] }),
  };

  const small = renderLabel(buildPriceTag7030(toPriceTag7030Input(item)));
  const big = renderLabel(
    buildPriceTag7090(toPriceTag7090Input(item, { storeName: "KTP Mart" })),
  );

  for (const zpl of [small, big]) {
    assert.match(zpl, /^\^XA\n\^CI28\n/, "UTF-8 must be declared before any field");
    assert.ok(zpl.includes("[농심] 새우깡"), "the hangul name survives");
    assert.ok(zpl.endsWith("^XZ"));
  }

  // The 70x30 price is four fields (`$`, dollars, cents, unit) so it reads from
  // two metres away; the was-price is one string in the footer.
  assert.ok(small.includes("^FD55^FS"), "the promo dollars");
  assert.ok(small.includes("was $62.00  26/08 - 27/08"));

  // The 70x90 promo-member tag leads with the member price and keeps the guest
  // price on its own compact line.
  assert.ok(big.includes("GUEST $55.00 /ea"));
  assert.ok(big.includes("^FD$49^FS"), "the member price is the big one");
  assert.ok(big.includes("Was $62.00"));
  assert.ok(big.includes("SAVE $12.10"), "the saving is measured off the member price");
  assert.ok(big.includes("Special"), "the promo name beats the store name");
});

test("copies ride through as ^PQ", () => {
  const zpl = renderLabel(buildPriceTag7030(toPriceTag7030Input(ITEM), { copies: 3 }));
  assert.ok(zpl.includes("^PQ3"));
});

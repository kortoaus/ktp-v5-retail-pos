import assert from "node:assert/strict";
import test from "node:test";

import { attachItemsToHotkeyKeys, enrichItemsWithPrices } from "./item.enrich";
import { buildCloudHotkeysResult } from "../hotkey/hotkey.service";

// T-24 (audit R-13) — the Map joins must answer byte-for-byte what the old
// Array.find joins answered. The legacy implementations are kept here verbatim
// (as of main 1dea321) as the oracle.

type Item = { id: number; name_en: string; barcode: string; brand: { name: string } | null };
type Price = { id: number; itemId: number; prices: number[]; archived: boolean };
type Promo = { id: number; itemId: number; prices: number[]; validFrom: string; validTo: string };
type Key = { id: number; hotkeyId: number; x: number; y: number; itemId: number; name: string; color: string };
type Hotkey = { id: number; name: string; sort: number; color: string; keys: Key[] };

// ── legacy oracles ────────────────────────────────────────────────
function legacyPatchItemPrice(items: Item[], prices: Price[], promoPrices: Promo[]) {
  return items.map((item) => {
    const price = prices.find((price) => price.itemId === item.id) || null;
    const promoPrice =
      promoPrices.find((promoPrice) => promoPrice.itemId === item.id) || null;
    return {
      ...item,
      price,
      promoPrice,
    };
  });
}

function legacyHotkeys(hotkeys: Hotkey[], items: Item[]) {
  return hotkeys.map((hotkey) => ({
    ...hotkey,
    keys: hotkey.keys.map((key) => ({
      ...key,
      item: items.find((item) => item.id === key.itemId),
    })),
  }));
}

function legacyCloudHotkeys(result: Hotkey[], items: Item[], prices: Price[], promoPrices: Promo[]) {
  const itemsWithPrices = items.map((item) => {
    const price = prices.find((price) => price.itemId === item.id) || null;
    const promoPrice =
      promoPrices.find((promoPrice) => promoPrice.itemId === item.id) || null;

    return {
      ...item,
      price: price ? { ...price, prices: price.prices.slice(0, 1) } : null,
      promoPrice: promoPrice
        ? { ...promoPrice, prices: promoPrice.prices.slice(0, 1) }
        : null,
    };
  });

  return result.map((hotkey) => ({
    ...hotkey,
    keys: hotkey.keys.map((key) => ({
      ...key,
      item: itemsWithPrices.find((item) => item.id === key.itemId),
    })),
  }));
}

// ── fixture: duplicates (first wins), gaps, missing items ─────────
const items: Item[] = [
  { id: 10, name_en: "Kimchi 1kg", barcode: "8801234567893", brand: { name: "Jongga" } },
  { id: 11, name_en: "Tofu", barcode: "8801111111116", brand: null },
  { id: 12, name_en: "Ramen", barcode: "8802222222229", brand: { name: "Nongshim" } },
  { id: 13, name_en: "Loose apples", barcode: "0201234", brand: null },
];
const prices: Price[] = [
  { id: 1, itemId: 10, prices: [1290, 1190, 1090], archived: false },
  { id: 2, itemId: 12, prices: [450, 420], archived: false },
  { id: 3, itemId: 10, prices: [9999], archived: false }, // duplicate — must lose
  { id: 4, itemId: 99, prices: [1], archived: false }, // no such item
];
const promos: Promo[] = [
  { id: 7, itemId: 12, prices: [399, 380], validFrom: "2026-10-01", validTo: "2026-10-31" },
  { id: 8, itemId: 12, prices: [1], validFrom: "2026-10-01", validTo: "2026-10-31" }, // duplicate
  { id: 9, itemId: 13, prices: [250], validFrom: "2026-10-01", validTo: "2026-10-31" },
];
const hotkeys: Hotkey[] = [
  {
    id: 1,
    name: "Fresh",
    sort: 0,
    color: "#ff0000",
    keys: [
      { id: 100, hotkeyId: 1, x: 0, y: 0, itemId: 13, name: "Apple", color: "#fff" },
      { id: 101, hotkeyId: 1, x: 1, y: 0, itemId: 404, name: "Gone", color: "#fff" }, // missing item
      { id: 102, hotkeyId: 1, x: 2, y: 0, itemId: 10, name: "Kimchi", color: "#0f0" },
    ],
  },
  { id: 2, name: "Empty", sort: 1, color: "#000", keys: [] },
  {
    id: 3,
    name: "Dry",
    sort: 2,
    color: "#00f",
    keys: [{ id: 103, hotkeyId: 3, x: 0, y: 1, itemId: 12, name: "Ramen", color: "#ccc" }],
  },
];

test("item pricing join is byte-identical to the Array.find version", () => {
  assert.equal(
    JSON.stringify(enrichItemsWithPrices(items, prices, promos)),
    JSON.stringify(legacyPatchItemPrice(items, prices, promos)),
  );
});

test("hotkey join is byte-identical to the Array.find version", () => {
  assert.equal(
    JSON.stringify(attachItemsToHotkeyKeys(hotkeys, items)),
    JSON.stringify(legacyHotkeys(hotkeys, items)),
  );
});

test("cloud hotkey join (first price level only) is byte-identical", () => {
  const next = JSON.stringify(buildCloudHotkeysResult(hotkeys, items, prices, promos));
  assert.equal(next, JSON.stringify(legacyCloudHotkeys(hotkeys, items, prices, promos)));
  // and the projection really happened
  assert.match(next, /"prices":\[1290\]/);
});

test("empty inputs stay empty", () => {
  assert.deepEqual(enrichItemsWithPrices([], prices, promos), []);
  assert.deepEqual(attachItemsToHotkeyKeys([], items), []);
});

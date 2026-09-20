// node --experimental-strip-types --test src/renderer/src/libs/scale-recent-items.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  RECENT_ITEMS_CAP, parseRecentItems, pushRecent,
  recentItemsStorageKey, serializeRecentItems,
} from "./scale-recent-items.ts";

const entry = (id) => ({ id, name_en: `Item ${id}`, name_ko: "", thumb: null });

test("recent selections are newest first, capped at runner's 12 entries", () => {
  let items = [];
  for (let id = 1; id <= 15; id++) items = pushRecent(items, entry(id));
  assert.equal(RECENT_ITEMS_CAP, 12);
  assert.deepEqual(items.map((item) => item.id), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4]);
});

test("reselection promotes and refreshes the snapshot without mutating the list", () => {
  const original = Object.freeze([entry(2), entry(1)]);
  const fresh = { ...entry(1), name_en: "New name", thumb: "new-thumb" };
  assert.deepEqual(pushRecent(original, fresh), [fresh, entry(2)]);
  assert.deepEqual(original, [entry(2), entry(1)]);
  assert.deepEqual(pushRecent(original, fresh, 1), [fresh]);
});

test("missing, malformed and non-array storage safely starts empty", () => {
  for (const raw of [null, "", "broken", "null", "{}", "42"]) {
    assert.deepEqual(parseRecentItems(raw), []);
  }
});

test("storage restores valid unique snapshots in order and strips stale price data", () => {
  const snapshot = { ...entry(2), thumb: "thumb", price: { prices: [100] } };
  const raw = JSON.stringify([
    null, {}, { ...entry(1), id: "1" }, { ...entry(1), id: 1.5 },
    { ...entry(1), thumb: 42 }, { ...entry(1), name_en: null },
    { ...entry(1), name_ko: null }, snapshot, entry(2), entry(1),
  ]);
  assert.deepEqual(parseRecentItems(raw), [{ ...entry(2), thumb: "thumb" }, entry(1)]);
});

test("storage round trip and cap preserve most-recent ordering", () => {
  const items = Array.from({ length: 20 }, (_, id) => entry(20 - id));
  assert.deepEqual(parseRecentItems(serializeRecentItems(items)), items.slice(0, 12));
});

test("storage is isolated by server and terminal, without a user key", () => {
  const key = recentItemsStorageKey("http://store-a:2200", 1);
  assert.equal(key, recentItemsStorageKey("http://store-a:2200", 1));
  assert.notEqual(key, recentItemsStorageKey("http://store-a:2200", 2));
  assert.notEqual(key, recentItemsStorageKey("http://store-b:2200", 1));
});

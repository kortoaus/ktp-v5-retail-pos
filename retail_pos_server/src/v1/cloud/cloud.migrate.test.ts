import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "../../libs/exceptions";
import { ean13CheckDigit } from "../../libs/barcode-utils";
import {
  CURSOR_OVERLAP_MS,
  FEED_TX_TIMEOUT_MS,
  ITEM_TX_TIMEOUT_MS,
  cloudBrandMigrate,
  cloudHotkeyMigrate,
  cloudItemMigrate,
  cloudPriceMigrate,
  nextCursorAt,
  normalizeBarcodes,
  type MigrateDeps,
} from "./cloud.migrate.core";
import { createCoalescedRunner } from "./cloud.migrate.runner";
import { FakeCatalogDb, FakeCloud, cloudItem } from "./cloud.migrate.test-fakes";

// T-16 (platform/D-12, audit R-6 + R-14) — catalog down-sync cursor and
// barcode normalisation, offline with a fake db and a fake api-server.

const ITEM = "/device/migrate/item";
const PRICE = "/device/migrate/price/retail";
const HOTKEY = "/device/migrate/hotkey/retail";
const BRAND = "/device/migrate/brand";

const T0 = new Date("2026-10-08T01:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function setup() {
  const db = new FakeCatalogDb();
  const cloud = new FakeCloud();
  const deps: MigrateDeps = { db, api: cloud };
  return { db, cloud, deps };
}

const quiet = () => {
  const log = console.log;
  console.log = () => {};
  return () => {
    console.log = log;
  };
};

function validEan13(body12: string) {
  return body12 + String(ean13CheckDigit(body12));
}

test("cursor is read from CloudSyncCursor, never from the local table's max updatedAt", async () => {
  const { db, cloud, deps } = setup();
  // Local row stamped far ahead by local writes; the cursor row is the truth.
  db.tables.item.push({ ...cloudItem(1, at(0)), updatedAt: new Date("2031-01-01T00:00:00Z") });
  db.setCursor("item", at(-60_000));
  const restore = quiet();
  try {
    await cloudItemMigrate(deps);
  } finally {
    restore();
  }
  assert.equal(cloud.lastCall(ITEM)?.lastUpdatedAt, at(-60_000).getTime());
  assert.deepEqual(db.lockLog, ["wait item", "lock item"]);
});

test("missing cursor row pulls from epoch 0", async () => {
  const { cloud, deps } = setup();
  const restore = quiet();
  try {
    await cloudBrandMigrate(deps);
  } finally {
    restore();
  }
  assert.equal(cloud.lastCall(BRAND)?.lastUpdatedAt, 0);
});

test("a cloud change stamped earlier than the local write time is still pulled next Sync", async () => {
  const { db, cloud, deps } = setup();
  db.localNow = () => at(60 * 60_000); // store clock / local writes an hour later
  cloud.put(ITEM, cloudItem(1, at(0)));
  const restore = quiet();
  try {
    await cloudItemMigrate(deps);
    // Cursor is cloud max - overlap, not the local write time.
    assert.equal(db.cursor("item")?.getTime(), at(-CURSOR_OVERLAP_MS).getTime());

    // B was updated in the cloud after A but long before the local write time,
    // and committed after the first pull.
    cloud.put(ITEM, cloudItem(2, at(1_000)));
    // C was stamped just before A but committed late (inside the overlap).
    cloud.put(ITEM, cloudItem(3, at(-1_000)));
    await cloudItemMigrate(deps);
  } finally {
    restore();
  }
  const ids = db.tables.item.map((r) => r.id).sort();
  assert.deepEqual(ids, [1, 2, 3]);
  assert.equal(db.cursor("item")?.getTime(), at(1_000 - CURSOR_OVERLAP_MS).getTime());
});

test("a batch that throws writes nothing and leaves the cursor unchanged", async () => {
  const { db, cloud, deps } = setup();
  db.setCursor("item", at(-10_000));
  cloud.put(ITEM, cloudItem(1, at(0), { scaleData: { itemId: 1, fixedWeightString: null, usedBy: 1, isFixedWeight: false, ingredients: null } }));
  cloud.put(ITEM, cloudItem(2, at(1_000), { scaleData: { itemId: 2, fixedWeightString: null, usedBy: 1, isFixedWeight: false, ingredients: null } }));
  db.failOn = (model, op, args) =>
    model === "itemScaleData" && op === "create" && (args as { data: { itemId: number } }).data.itemId === 2;

  const restore = quiet();
  try {
    await assert.rejects(cloudItemMigrate(deps), /injected failure/);
  } finally {
    restore();
  }
  assert.equal(db.tables.item.length, 0);
  assert.equal(db.tables.itemScaleData.length, 0);
  assert.equal(db.cursor("item")?.getTime(), at(-10_000).getTime());
  // every write was attempted inside the transaction
  assert.ok(db.writes.length > 0 && db.writes.every((w) => w.inTx));
});

test("a hotkey whose keys fail to insert rolls back the hotkey row and keeps the cursor", async () => {
  const { db, cloud, deps } = setup();
  db.setCursor("hotkey", at(-10_000));
  cloud.put(HOTKEY, {
    id: 7, companyId: 1, sort: 1, name_en: "Fruit", name_ko: "과일", color: "x", archived: false,
    updatedAt: at(0), createdAt: at(0),
    keys: [{ id: 70, companyId: 1, hotkeyId: 7, x: 0, y: 0, itemId: 1, color: "x", page: 1 }],
  });
  db.failOn = (model, op) => model === "cloudHotkeyItem" && op === "createMany";
  const restore = quiet();
  try {
    await assert.rejects(cloudHotkeyMigrate(deps), /injected failure/);
  } finally {
    restore();
  }
  assert.equal(db.tables.cloudHotkey.length, 0);
  assert.equal(db.cursor("hotkey")?.getTime(), at(-10_000).getTime());

  db.failOn = null;
  const restore2 = quiet();
  try {
    await cloudHotkeyMigrate(deps);
  } finally {
    restore2();
  }
  assert.equal(db.tables.cloudHotkey.length, 1);
  assert.equal(db.tables.cloudHotkeyItem.length, 1);
  assert.equal(db.cursor("hotkey")?.getTime(), at(-CURSOR_OVERLAP_MS).getTime());
  assert.equal(db.transactions[1].timeout, FEED_TX_TIMEOUT_MS);
});

test("cloud !ok throws an HttpException and leaves the cursor unchanged", async () => {
  const { db, cloud, deps } = setup();
  db.setCursor("price", at(0));
  cloud.failWith = "nope";
  await assert.rejects(cloudPriceMigrate(deps), (e) => e instanceof HttpException);
  assert.equal(db.cursor("price")?.getTime(), at(0).getTime());
  assert.equal(db.writes.length, 0);
});

test("an empty response keeps the cursor and writes nothing", async () => {
  const { db, cloud, deps } = setup();
  db.setCursor("price", at(5_000));
  cloud.put(PRICE, { id: 1, companyId: 1, itemId: 1, priceType: "RETAIL", prices: [100], archived: false, markup: 1, createdAt: at(0), updatedAt: at(0) });
  const restore = quiet();
  try {
    await cloudPriceMigrate(deps); // row at T0 is older than the cursor → empty
  } finally {
    restore();
  }
  assert.equal(cloud.lastCall(PRICE)?.lastUpdatedAt, at(5_000).getTime());
  assert.equal(db.cursor("price")?.getTime(), at(5_000).getTime());
  assert.equal(db.writes.length, 0);
});

test("parentId is written inside the same transaction, keeping the cloud updatedAt", async () => {
  const { db, cloud, deps } = setup();
  // child listed before its parent: the link must wait for the parent row
  cloud.put(ITEM, cloudItem(10, at(2_000), { parentId: 11, isBundle: true }));
  cloud.put(ITEM, cloudItem(11, at(1_000)));
  const restore = quiet();
  try {
    await cloudItemMigrate(deps);
  } finally {
    restore();
  }
  const link = db.writes.find((w) => w.model === "item" && w.op === "update");
  assert.ok(link, "parent link written");
  assert.equal(link.inTx, true);
  const cursorWrite = db.writes.findIndex((w) => w.model === "cloudSyncCursor");
  assert.equal(cursorWrite, db.writes.length - 1, "cursor is the batch's last write");
  assert.equal(db.writes[cursorWrite].inTx, true, "cursor commits with the batch");

  const child = db.tables.item.find((r) => r.id === 10)!;
  assert.equal(child.parentId, 11);
  assert.equal(new Date(child.updatedAt as string).getTime(), at(2_000).getTime());
  assert.equal(db.transactions.length, 1);
  assert.equal(db.transactions[0].timeout, ITEM_TX_TIMEOUT_MS);
  // only the one row with a parent gets the second write
  assert.equal(db.writes.filter((w) => w.model === "item" && w.op === "update").length, 1);
});

test("item upsert re-normalises only when the barcode changed", async () => {
  const { db, cloud, deps } = setup();
  const ean = validEan13("930063360348");
  // stored row: same barcode, tuple kept as stored (not recomputed)
  db.tables.item.push({ ...cloudItem(1, at(-100_000), { barcode: "ABC" }), barcodeType: "RAW", barcodeGTIN: null, barcodePLU: null });
  // stored row: barcode about to change to a valid EAN
  db.tables.item.push({ ...cloudItem(2, at(-100_000), { barcode: "OLD" }), barcodeType: "RAW" });
  cloud.put(ITEM, cloudItem(1, at(0), { barcode: "ABC", barcodeType: "GTIN", barcodeGTIN: "cloud-value" }));
  cloud.put(ITEM, cloudItem(2, at(0), { barcode: ean }));
  cloud.put(ITEM, cloudItem(3, at(0), { barcode: "0212345" })); // new row
  const restore = quiet();
  try {
    await cloudItemMigrate(deps);
  } finally {
    restore();
  }
  const row = (id: number) => db.tables.item.find((r) => r.id === id)!;
  assert.deepEqual([row(1).barcodeType, row(1).barcodeGTIN, row(1).barcodePLU], ["RAW", null, null]);
  assert.deepEqual([row(2).barcodeType, row(2).barcodeGTIN], ["EAN", "0" + ean]);
  assert.deepEqual([row(3).barcodeType, row(3).barcodePLU], ["PLU", "0212345"]);
});

test("normalizeBarcodes skips unchanged RAW/normalised rows and writes only stale ones", async () => {
  const { db } = setup();
  const ean = validEan13("930063360348");
  db.tables.item.push({ ...cloudItem(1, at(0), { barcode: "ABC" }) }); // RAW, correct
  db.tables.item.push({ ...cloudItem(2, at(0), { barcode: "12345" }) }); // invalid numeric → RAW, correct
  db.tables.item.push({ ...cloudItem(3, at(0), { barcode: "0212345", barcodeType: "PLU", barcodePLU: "0212345" }) });
  db.tables.item.push({ ...cloudItem(4, at(0), { barcode: ean }) }); // stale: should be EAN

  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    const first = await normalizeBarcodes(db);
    assert.deepEqual(first, { normalized: 1, checked: 4, skipped: 3 });
    const second = await normalizeBarcodes(db);
    assert.deepEqual(second, { normalized: 0, checked: 4, skipped: 4 });
  } finally {
    console.log = log;
  }
  const updates = db.writes.filter((w) => w.model === "item" && w.op === "update");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].args, { where: { id: 4 }, data: { barcodeType: "EAN", barcodeGTIN: "0" + ean, barcodePLU: null } });
  // unchanged rows keep their updatedAt (no churn)
  assert.equal(new Date(db.tables.item[0].updatedAt as Date).getTime(), at(0).getTime());
  assert.match(lines[lines.length - 1] ?? "", /barcodes: normalized 0 \/ checked 4 \/ skipped 4/);
});

test("nextCursorAt: max - overlap, never backwards, null without a usable updatedAt", () => {
  const cur = at(0);
  assert.equal(nextCursorAt([{ updatedAt: at(10_000).toISOString() }, { updatedAt: at(5_000) }], cur)?.getTime(), at(10_000 - CURSOR_OVERLAP_MS).getTime());
  assert.equal(nextCursorAt([{ updatedAt: at(1_000) }], cur)?.getTime(), cur.getTime());
  assert.equal(nextCursorAt([{ updatedAt: "garbage" }], cur), null);
});

// ---- F-15: concurrent Syncs

const price = (id: number, prices: number[], updatedAt: Date) => ({
  id, companyId: 1, itemId: id, priceType: "RETAIL", prices, archived: false, markup: 1, createdAt: at(0), updatedAt,
});

test("two overlapping runs (slow first answer) serialise: newest row stored, cursor matches the stored rows", async () => {
  const { db, cloud, deps } = setup();
  db.setCursor("price", at(-60_000));
  cloud.put(PRICE, price(1, [100], at(0)));
  cloud.delays = [30, 0]; // run A's answer is slow; run B's would be instant

  const restore = quiet();
  try {
    const runA = cloudPriceMigrate(deps);
    while (cloud.calls.length < 1) await new Promise((r) => setImmediate(r));
    // cloud changes after A's response snapshot was taken
    cloud.put(PRICE, price(1, [200], at(5_000)));
    const runB = cloudPriceMigrate(deps);
    await Promise.all([runA, runB]);
  } finally {
    restore();
  }

  // B fetched only after A committed, from A's cursor.
  assert.equal(cloud.calls.length, 2);
  assert.equal(cloud.calls[1].lastUpdatedAt, at(-CURSOR_OVERLAP_MS).getTime());
  assert.deepEqual(db.lockLog, ["wait price", "lock price", "wait price", "lock price"]);

  const stored = db.tables.price.find((r) => r.id === 1)!;
  assert.deepEqual(stored.prices, [200]);
  const storedMax = new Date(stored.updatedAt as string).getTime();
  assert.equal(db.cursor("price")?.getTime(), storedMax - CURSOR_OVERLAP_MS);
});

test("pipeline runner: a request during a run waits and shares one coalesced follow-up run", async () => {
  let calls = 0;
  const gates: (() => void)[] = [];
  const runner = createCoalescedRunner(async () => {
    const n = ++calls;
    await new Promise<void>((r) => gates.push(r));
    return n;
  });

  const first = runner();
  const second = runner();
  const third = runner();
  assert.equal(second, third, "callers during a run share one follow-up");
  assert.equal(calls, 1, "no second run while the first is in flight");

  gates[0]();
  assert.equal(await first, 1);
  while (calls < 2) await new Promise((r) => setImmediate(r));
  gates[1]();
  assert.equal(await second, 2);
  assert.equal(await third, 2);
  assert.equal(calls, 2);

  // idle again: the next request starts a fresh run
  const fourth = runner();
  while (calls < 3) await new Promise((r) => setImmediate(r));
  gates[2]();
  assert.equal(await fourth, 3);
});

test("pipeline runner: a failed run rejects its callers and the follow-up still runs", async () => {
  let calls = 0;
  const runner = createCoalescedRunner(async () => {
    calls++;
    await new Promise((r) => setImmediate(r));
    if (calls === 1) throw new Error("boom");
    return "ok";
  });
  const first = runner();
  const second = runner();
  await assert.rejects(first, /boom/);
  assert.equal(await second, "ok");
  assert.equal(calls, 2);
});

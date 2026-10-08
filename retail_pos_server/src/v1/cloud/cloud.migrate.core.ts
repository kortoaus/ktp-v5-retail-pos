// Catalog down-sync core (T-16 / D-12, audit R-6 + R-14; review F-15).
//
// Each feed (brand, item, price, promoPrice, hotkey) runs ONE interactive
// transaction that:
//   1. locks its CloudSyncCursor row (`SELECT … FOR UPDATE`, row created at
//      epoch if missing) and reads the cursor under that lock — never from a
//      local @updatedAt column, which the sync itself advances to local time;
//   2. asks the cloud for rows with cloud updatedAt > cursor;
//   3. writes the whole batch;
//   4. moves the cursor to max(response.updatedAt) - CURSOR_OVERLAP_MS (never
//      backwards; unchanged when the response is empty) as its last statement.
// The cursor change becomes visible only when the batch commits; a throw rolls
// back both. Holding the row lock from read to commit serialises the whole
// read → fetch → write → advance sequence per feed, so two runs (even from
// different processes) cannot interleave an older response over a newer one
// (F-15). In-process the controller also serialises the pipeline
// (cloud.migrate.runner.ts).
// Company is pulled whole on every sync and has no cursor.
//
// Dependencies are injected so the logic runs offline in node:test with fakes
// (cloud.migrate.test.ts); cloud.migrate.service.ts wires the real db/api.
import type {
  CloudHotkey,
  CloudHotkeyItem,
  Item,
  ItemScaleData,
  Price,
  PromoPrice,
  Brand,
} from "../../generated/prisma/client";
import { getNormalizedBarcode } from "../../libs/barcode-utils";
import { BadRequestException } from "../../libs/exceptions";

export const tag = "[cloud-migrate]";

export type CursorKind = "brand" | "item" | "price" | "promoPrice" | "hotkey";

// A cloud commit can land with an updatedAt slightly older than rows already
// returned (updatedAt is stamped before commit). Re-pulling the last 2 s each
// time catches that; upserts make the overlap harmless.
export const CURSOR_OVERLAP_MS = 2_000;

// Interactive transaction budgets. Prisma's default is 5 s, too short for a
// full catalog: a fresh store (cursor at epoch) or a long-offline store pulls
// every item, and each item costs ~4-5 statements (upsert, scaleData
// delete+create, parentId update) — roughly 1 ms each on the store PC, so a
// 20k-item catalog is ~100 s. The cloud fetch (axios timeout 30 s) now runs
// inside the transaction too. 5 min gives ~2.5x headroom. Smaller feeds: 2 min.
export const ITEM_TX_TIMEOUT_MS = 300_000;
export const FEED_TX_TIMEOUT_MS = 120_000;
export const TX_MAX_WAIT_MS = 10_000;

// ---- injected dependencies (narrow structural views of PrismaClient / apiService)

// Method syntax on purpose: argument types are checked bivariantly, so the
// real Prisma delegates (generic, heavily typed args) satisfy these views
// without casts, and test fakes stay small.
export type StoredItemRow = NormTuple & { id: number; barcode: string };
export interface MigrateTx {
  item: {
    findMany(args: unknown): Promise<StoredItemRow[]>;
    upsert(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  itemScaleData: {
    deleteMany(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
  brand: { upsert(args: unknown): Promise<unknown> };
  price: { upsert(args: unknown): Promise<unknown> };
  promoPrice: { upsert(args: unknown): Promise<unknown> };
  cloudHotkey: { upsert(args: unknown): Promise<unknown> };
  cloudHotkeyItem: {
    deleteMany(args: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<unknown>;
  };
  cloudSyncCursor: {
    findUnique(args: unknown): Promise<{ cursorAt: Date } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export interface MigrateDb extends MigrateTx {
  $transaction<R>(
    fn: (tx: MigrateTx) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R>;
}

export interface MigrateApi {
  post<T>(
    endpoint: string,
    data?: unknown,
  ): Promise<{ ok: boolean; msg?: string; result?: T | null }>;
}

export interface MigrateDeps {
  db: MigrateDb;
  api: MigrateApi;
}

// ---- cursor

const EPOCH = new Date(0);

/**
 * Inside a transaction: make sure the feed's cursor row exists (epoch if it was
 * missing), take its row lock until commit/rollback, then read its value.
 */
export async function lockAndReadCursor(tx: MigrateTx, kind: CursorKind) {
  await tx.$executeRaw`INSERT INTO "CloudSyncCursor" ("kind", "cursorAt", "updatedAt") VALUES (${kind}, TIMESTAMP '1970-01-01 00:00:00', CURRENT_TIMESTAMP) ON CONFLICT ("kind") DO NOTHING`;
  await tx.$queryRaw`SELECT "kind" FROM "CloudSyncCursor" WHERE "kind" = ${kind} FOR UPDATE`;
  const row = await tx.cloudSyncCursor.findUnique({ where: { kind } });
  return row?.cursorAt ?? EPOCH;
}

/** max(updatedAt) - overlap, never earlier than the current cursor; null when no row has a usable updatedAt. */
export function nextCursorAt(
  rows: { updatedAt: Date | string }[],
  current: Date,
): Date | null {
  let max = -Infinity;
  for (const row of rows) {
    const t = new Date(row.updatedAt).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  if (!Number.isFinite(max)) return null;
  return new Date(Math.max(current.getTime(), max - CURSOR_OVERLAP_MS));
}

type FeedRow = { updatedAt: Date | string };

/**
 * Generic feed runner — one transaction from cursor lock to cursor advance.
 * Throws BadRequestException when the cloud says !ok; any throw (including
 * from `write`) rolls back the batch and leaves the cursor unchanged.
 */
async function runFeed<T extends FeedRow>(
  deps: MigrateDeps,
  opts: {
    kind: CursorKind;
    label: string;
    endpoint: string;
    errorMsg: string;
    timeoutMs: number;
    write: (tx: MigrateTx, rows: T[]) => Promise<void>;
  },
): Promise<number> {
  const { db, api } = deps;

  const { received, cursorAt } = await db.$transaction(
    async (tx) => {
      const cursor = await lockAndReadCursor(tx, opts.kind);

      const { ok, msg, result } = await api.post<T[]>(opts.endpoint, {
        lastUpdatedAt: cursor.getTime(),
      });
      if (!ok || !result) {
        throw new BadRequestException(msg || opts.errorMsg);
      }
      if (result.length === 0) return { received: 0, cursorAt: cursor };

      await opts.write(tx, result);

      // Last statement of the batch: visible only if the batch commits.
      const next = nextCursorAt(result, cursor);
      if (!next) {
        console.warn(`${tag} ${opts.label}: no usable updatedAt in response; cursor kept`);
        return { received: result.length, cursorAt: cursor };
      }
      if (next.getTime() !== cursor.getTime()) {
        await tx.cloudSyncCursor.upsert({
          where: { kind: opts.kind },
          create: { kind: opts.kind, cursorAt: next },
          update: { cursorAt: next },
        });
      }
      return { received: result.length, cursorAt: next };
    },
    { maxWait: TX_MAX_WAIT_MS, timeout: opts.timeoutMs },
  );

  console.log(
    `${tag} ${opts.label}: ${received} synced (cursor ${cursorAt.toISOString()})`,
  );
  return received;
}

// ---- barcode normalisation

type NormTuple = {
  barcodeType: string;
  barcodeGTIN: string | null;
  barcodePLU: string | null;
};

const STORED_ITEM_SELECT = {
  id: true,
  barcode: true,
  barcodeType: true,
  barcodeGTIN: true,
  barcodePLU: true,
} as const;
const ID_CHUNK = 5_000;

export function normalizedTuple(barcode: string): NormTuple {
  const { type, gtin14, plu } = getNormalizedBarcode(barcode);
  return { barcodeType: type, barcodeGTIN: gtin14, barcodePLU: plu };
}

function sameTuple(a: NormTuple, b: NormTuple) {
  return (
    a.barcodeType === b.barcodeType &&
    a.barcodeGTIN === b.barcodeGTIN &&
    a.barcodePLU === b.barcodePLU
  );
}

// ---- item

export type ItemWithRelations = Item & {
  scaleData: ItemScaleData | null;
};

export function toLocalItemData(
  item: ItemWithRelations,
): Omit<Item, "parent" | "children" | "brand" | "scaleData" | "categoryIds"> {
  return {
    id: item.id,
    companyId: item.companyId,
    name_en: item.name_en,
    name_ko: item.name_ko,
    name_invoice: item.name_invoice,
    barcode: item.barcode,
    code: item.code,
    thumb: item.thumb,
    barcodeGTIN: item.barcodeGTIN,
    barcodePLU: item.barcodePLU,
    barcodeType: item.barcodeType,
    uom: item.uom,
    defaultRFD: item.defaultRFD,
    isScale: item.isScale,
    isBundle: item.isBundle,
    useBatch: item.useBatch,
    archived: item.archived,
    bundleQty: item.bundleQty,
    parentId: item.parentId,
    brandId: item.brandId,
    categoryMarks: item.categoryMarks,
    taxable: item.taxable,
    wholesaleTaxable: item.wholesaleTaxable,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isTemporary: item.isTemporary,
    isPointExcluded: item.isPointExcluded,
  };
}

async function writeItemBatch(tx: MigrateTx, items: ItemWithRelations[]) {
  // Stored barcode + normalised tuple, to normalise only on change (R-14).
  // Chunked so a full-catalog batch stays under Postgres' bind-parameter limit.
  const stored = new Map<number, StoredItemRow>();
  for (let i = 0; i < items.length; i += ID_CHUNK) {
    const ids = items.slice(i, i + ID_CHUNK).map((it) => it.id);
    const rows = await tx.item.findMany({
      where: { id: { in: ids } },
      select: STORED_ITEM_SELECT,
    });
    for (const r of rows) stored.set(r.id, r);
  }

  let normalized = 0;
  for (const item of items) {
    const { scaleData } = item;
    const prev = stored.get(item.id);
    const changed = !prev || prev.barcode !== item.barcode || prev.barcodeType == null;
    let norm: NormTuple;
    if (changed) {
      norm = normalizedTuple(item.barcode);
      normalized++;
    } else {
      norm = {
        barcodeType: prev.barcodeType,
        barcodeGTIN: prev.barcodeGTIN,
        barcodePLU: prev.barcodePLU,
      };
    }

    const data = { ...toLocalItemData(item), parentId: null, ...norm };
    await tx.item.upsert({
      where: { id: item.id },
      update: data,
      create: data,
    });

    if (scaleData) {
      await tx.itemScaleData.deleteMany({ where: { itemId: item.id } });
      await tx.itemScaleData.create({
        data: { ...scaleData, itemId: item.id },
      });
    }
  }

  // Parent links after every row of the batch exists — same transaction.
  // updatedAt is passed through so the row keeps the cloud timestamp.
  for (const item of items) {
    if (item.parentId == null) continue;
    await tx.item.update({
      where: { id: item.id },
      data: { parentId: item.parentId, updatedAt: item.updatedAt },
    });
  }

  console.log(
    `${tag} items: barcodes normalized ${normalized} / checked ${items.length} / skipped ${items.length - normalized}`,
  );
}

export function cloudItemMigrate(deps: MigrateDeps) {
  return runFeed<ItemWithRelations>(deps, {
    kind: "item",
    label: "items",
    endpoint: "/device/migrate/item",
    errorMsg: "Failed to migrate items from cloud",
    timeoutMs: ITEM_TX_TIMEOUT_MS,
    write: writeItemBatch,
  });
}

// ---- brand / price / promo price

export function cloudBrandMigrate(deps: MigrateDeps) {
  return runFeed<Brand>(deps, {
    kind: "brand",
    label: "brands",
    endpoint: "/device/migrate/brand",
    errorMsg: "Failed to migrate brands from cloud",
    timeoutMs: FEED_TX_TIMEOUT_MS,
    write: async (tx, rows) => {
      for (const brand of rows) {
        await tx.brand.upsert({
          where: { id: brand.id },
          update: { ...brand },
          create: { ...brand },
        });
      }
    },
  });
}

export function cloudPriceMigrate(deps: MigrateDeps) {
  return runFeed<Price>(deps, {
    kind: "price",
    label: "prices",
    endpoint: "/device/migrate/price/retail",
    errorMsg: "Failed to migrate prices from cloud",
    timeoutMs: FEED_TX_TIMEOUT_MS,
    write: async (tx, rows) => {
      for (const { prices, ...rest } of rows) {
        const data = { ...rest, prices };
        await tx.price.upsert({ where: { id: rest.id }, update: data, create: data });
      }
    },
  });
}

export function cloudPromoPriceMigrate(deps: MigrateDeps) {
  return runFeed<PromoPrice>(deps, {
    kind: "promoPrice",
    label: "promo-prices",
    endpoint: "/device/migrate/promo-price/retail",
    errorMsg: "Failed to migrate promo prices from cloud",
    timeoutMs: FEED_TX_TIMEOUT_MS,
    write: async (tx, rows) => {
      for (const { prices, ...rest } of rows) {
        const data = { ...rest, prices };
        await tx.promoPrice.upsert({ where: { id: rest.id }, update: data, create: data });
      }
    },
  });
}

// ---- hotkey

export type CloudHotkeyWithKeys = CloudHotkey & { keys: CloudHotkeyItem[] };

export function cloudHotkeyMigrate(deps: MigrateDeps) {
  return runFeed<CloudHotkeyWithKeys>(deps, {
    kind: "hotkey",
    label: "hotkeys",
    endpoint: "/device/migrate/hotkey/retail",
    errorMsg: "Failed to migrate hotkeys from cloud",
    timeoutMs: FEED_TX_TIMEOUT_MS,
    write: async (tx, rows) => {
      for (const { keys, ...rest } of rows) {
        await tx.cloudHotkey.upsert({
          where: { id: rest.id },
          create: { ...rest },
          update: { ...rest },
          select: { id: true },
        });
        await tx.cloudHotkeyItem.deleteMany({ where: { hotkeyId: rest.id } });
        await tx.cloudHotkeyItem.createMany({
          data: keys.map((key) => ({ ...key, hotkeyId: rest.id })),
        });
      }
    },
  });
}

// ---- standalone normalisation pass (manual Sync)

/**
 * Re-derives each item's normalised barcode and writes only rows whose stored
 * tuple differs (R-14): an unchanged RAW/invalid barcode produces no write and
 * no updatedAt churn.
 */
export async function normalizeBarcodes(db: Pick<MigrateTx, "item">) {
  const items = await db.item.findMany({ select: STORED_ITEM_SELECT });

  let normalized = 0;
  for (const item of items) {
    const next = normalizedTuple(item.barcode);
    if (item.barcodeType != null && sameTuple(item, next)) continue;
    await db.item.update({ where: { id: item.id }, data: next });
    normalized++;
  }

  const skipped = items.length - normalized;
  console.log(
    `${tag} barcodes: normalized ${normalized} / checked ${items.length} / skipped ${skipped}`,
  );
  return { normalized, checked: items.length, skipped };
}

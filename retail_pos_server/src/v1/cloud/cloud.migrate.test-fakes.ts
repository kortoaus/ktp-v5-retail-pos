// Test-only fakes for the T-16 catalog sync tests (not a *.test.ts file, so
// the runner does not execute it on its own). No DB, no network.
import type { MigrateApi, MigrateDb, MigrateTx, StoredItemRow } from "./cloud.migrate.core";

type Row = Record<string, unknown> & { id?: number };
type Where = Record<string, unknown>;

export type WriteLog = { model: string; op: string; inTx: boolean; args: unknown };

const MODELS = [
  "item",
  "itemScaleData",
  "brand",
  "price",
  "promoPrice",
  "cloudHotkey",
  "cloudHotkeyItem",
  "cloudSyncCursor",
] as const;
type Model = (typeof MODELS)[number];

function clone<T>(v: T): T {
  return structuredClone(v);
}

function matches(row: Row, where: Where | undefined) {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "in" in (v as object)) {
      return ((v as { in: unknown[] }).in).includes(row[k]);
    }
    return row[k] === v;
  });
}

function pick(row: Row, select: Record<string, boolean> | undefined) {
  if (!select) return clone(row);
  const out: Row = {};
  for (const [k, on] of Object.entries(select)) if (on) out[k] = row[k];
  return out;
}

/**
 * In-memory stand-in for the Prisma client subset the catalog sync uses.
 * - Models with @updatedAt stamp `localNow()` when a write omits updatedAt
 *   (like Prisma), so tests can reproduce local-clock churn.
 * - `$transaction` snapshots every table and restores it on throw (rollback).
 * - `failOn` injects a throw on a chosen write.
 */
export class FakeCatalogDb implements MigrateDb {
  tables: Record<Model, Row[]> = {
    item: [],
    itemScaleData: [],
    brand: [],
    price: [],
    promoPrice: [],
    cloudHotkey: [],
    cloudHotkeyItem: [],
    cloudSyncCursor: [],
  };
  writes: WriteLog[] = [];
  transactions: { maxWait?: number; timeout?: number }[] = [];
  inTx = false;
  localNow = () => new Date("2030-01-01T00:00:00.000Z");
  failOn: ((model: string, op: string, args: unknown) => boolean) | null = null;
  private nextHotkeyItemId = 1;

  private log(model: Model, op: string, args: unknown) {
    this.writes.push({ model, op, inTx: this.inTx, args: clone(args) });
    if (this.failOn?.(model, op, args)) throw new Error(`injected failure: ${model}.${op}`);
  }

  private key(model: Model) {
    return model === "itemScaleData" ? "itemId" : model === "cloudSyncCursor" ? "kind" : "id";
  }

  private stamp(model: Model, row: Row, data: Row) {
    const stamped = model !== "itemScaleData" && model !== "cloudHotkeyItem";
    if (stamped && data.updatedAt === undefined) row.updatedAt = this.localNow();
  }

  private upsertIn(model: Model, args: { where: Where; update: Row; create: Row }) {
    this.log(model, "upsert", args);
    const table = this.tables[model];
    const k = this.key(model);
    const existing = table.find((r) => r[k] === args.where[k]);
    if (existing) {
      Object.assign(existing, clone(args.update));
      this.stamp(model, existing, args.update);
      return clone(existing);
    }
    const row = clone(args.create);
    this.stamp(model, row, args.create);
    table.push(row);
    return clone(row);
  }

  private delegate(model: Model) {
    return {
      upsert: async (args: unknown) =>
        this.upsertIn(model, args as { where: Where; update: Row; create: Row }),
      findMany: async (args: unknown) => {
        const a = (args ?? {}) as { where?: Where; select?: Record<string, boolean> };
        return this.tables[model].filter((r) => matches(r, a.where)).map((r) => pick(r, a.select));
      },
      findUnique: async (args: unknown) => {
        const { where } = args as { where: Where };
        const row = this.tables[model].find((r) => matches(r, where));
        return row ? clone(row) : null;
      },
      update: async (args: unknown) => {
        const { where, data } = args as { where: Where; data: Row };
        this.log(model, "update", args);
        const row = this.tables[model].find((r) => matches(r, where));
        if (!row) throw new Error(`${model}: record to update not found`);
        Object.assign(row, clone(data));
        this.stamp(model, row, data);
        return clone(row);
      },
      deleteMany: async (args: unknown) => {
        const { where } = args as { where: Where };
        this.log(model, "deleteMany", args);
        const before = this.tables[model].length;
        this.tables[model] = this.tables[model].filter((r) => !matches(r, where));
        return { count: before - this.tables[model].length };
      },
      create: async (args: unknown) => {
        const { data } = args as { data: Row };
        this.log(model, "create", args);
        const row = clone(data);
        this.tables[model].push(row);
        return clone(row);
      },
      createMany: async (args: unknown) => {
        const { data } = args as { data: Row[] };
        this.log(model, "createMany", args);
        for (const d of data) {
          const row = clone(d);
          if (model === "cloudHotkeyItem" && row.id === undefined) row.id = this.nextHotkeyItemId++;
          this.tables[model].push(row);
        }
        return { count: data.length };
      },
    };
  }

  item = {
    ...this.delegate("item"),
    findMany: async (args: unknown) =>
      (await this.delegate("item").findMany(args)) as StoredItemRow[],
  };
  itemScaleData = this.delegate("itemScaleData");
  brand = this.delegate("brand");
  price = this.delegate("price");
  promoPrice = this.delegate("promoPrice");
  cloudHotkey = this.delegate("cloudHotkey");
  cloudHotkeyItem = this.delegate("cloudHotkeyItem");
  cloudSyncCursor = {
    findUnique: async (args: unknown) =>
      (await this.delegate("cloudSyncCursor").findUnique(args)) as { cursorAt: Date } | null,
    upsert: async (args: unknown) => this.delegate("cloudSyncCursor").upsert(args),
  };

  async $transaction<R>(
    fn: (tx: MigrateTx) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R> {
    this.transactions.push({ ...options });
    const snapshot = clone(this.tables);
    this.inTx = true;
    try {
      return await fn(this);
    } catch (e) {
      this.tables = snapshot;
      throw e;
    } finally {
      this.inTx = false;
    }
  }

  cursor(kind: string): Date | undefined {
    const row = this.tables.cloudSyncCursor.find((r) => r.kind === kind);
    return row ? new Date(row.cursorAt as Date) : undefined;
  }

  setCursor(kind: string, at: Date) {
    this.tables.cloudSyncCursor = this.tables.cloudSyncCursor.filter((r) => r.kind !== kind);
    this.tables.cloudSyncCursor.push({ kind, cursorAt: at, updatedAt: at });
  }
}

/**
 * Fake api-server: per-endpoint rows with a cloud `updatedAt`, filtered like
 * device.migrate.service (`updatedAt > lastUpdatedAt`) and JSON round-tripped
 * like the real HTTP response (dates arrive as ISO strings).
 */
export class FakeCloud implements MigrateApi {
  feeds = new Map<string, Row[]>();
  calls: { endpoint: string; lastUpdatedAt: number }[] = [];
  failWith: string | null = null;

  put(endpoint: string, row: Row) {
    const rows = (this.feeds.get(endpoint) ?? []).filter((r) => r.id !== row.id);
    rows.push(row);
    this.feeds.set(endpoint, rows);
  }

  async post<T>(endpoint: string, data?: unknown) {
    const { lastUpdatedAt } = data as { lastUpdatedAt: number };
    this.calls.push({ endpoint, lastUpdatedAt });
    if (this.failWith) return { ok: false, msg: this.failWith, result: null };
    const rows = (this.feeds.get(endpoint) ?? []).filter(
      (r) => new Date(r.updatedAt as string).getTime() > lastUpdatedAt,
    );
    return { ok: true, result: JSON.parse(JSON.stringify(rows)) as T };
  }

  lastCall(endpoint: string) {
    return [...this.calls].reverse().find((c) => c.endpoint === endpoint);
  }
}

export function cloudItem(id: number, updatedAt: Date, over: Partial<Row> = {}): Row {
  return {
    id,
    companyId: 1,
    name_en: `Item ${id}`,
    name_ko: `상품 ${id}`,
    name_invoice: null,
    barcode: `RAW-${id}`,
    code: null,
    thumb: null,
    barcodeGTIN: null,
    barcodePLU: null,
    barcodeType: "RAW",
    uom: "ea",
    defaultRFD: "D",
    isScale: false,
    isBundle: false,
    useBatch: false,
    archived: false,
    bundleQty: 1,
    parentId: null,
    brandId: null,
    categoryMarks: [],
    taxable: false,
    wholesaleTaxable: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt,
    isTemporary: false,
    isPointExcluded: false,
    scaleData: null,
    ...over,
  };
}

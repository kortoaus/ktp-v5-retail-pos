import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";

import app from "../app";
import itemRouter from "./item/item.router";
import cloudRouter from "./cloud/cloud.router";
import { createTerminalMiddleware } from "./terminal.middleware";
import {
  createSingleRowCache,
  withContext,
  type ContextLoaders,
} from "./request-context";
import { createUpdateStoreSettingService } from "./store/store.service";
import type {
  CompanyModel,
  StoreSettingModel,
  TerminalModel,
  TerminalShiftModel,
} from "../generated/prisma/models";

// T-24 (audit R-11) — terminal identification is one read; optional context
// is loaded by the routes that ask for it; single-row config is cached.

type Layer = {
  name?: string;
  handle?: { stack?: Layer[]; name?: string };
  route?: { path: string; stack: Layer[] };
};

function stackOf(router: unknown): Layer[] {
  return (router as { stack: Layer[] }).stack;
}

function routeHandlers(router: unknown, path: string): string[] {
  const layer = stackOf(router).find((l) => l.route?.path === path);
  assert.ok(layer?.route, `route ${path} exists`);
  return layer.route.stack.map((l) => l.name ?? "");
}

function countNamed(layers: Layer[], name: string): number {
  let n = 0;
  for (const l of layers) {
    if (l.name === name) n++;
    if (l.route) n += countNamed(l.route.stack, name);
    if (l.handle?.stack) n += countNamed(l.handle.stack, name);
  }
  return n;
}

function fakeRes() {
  return { locals: {} as Record<string, unknown> } as unknown as Response & {
    locals: Record<string, unknown>;
  };
}

test("terminalMiddleware performs exactly one read and sets only the terminal", async () => {
  let reads = 0;
  const mw = createTerminalMiddleware(async (ip) => {
    reads++;
    return { id: 4, ipAddress: ip, name: "T4" } as TerminalModel;
  });
  const res = fakeRes();
  let nexted = false;
  await mw(
    { headers: { "ip-address": "10.0.0.4" } } as unknown as Request,
    res,
    (() => (nexted = true)) as NextFunction,
  );
  assert.equal(reads, 1);
  assert.equal(nexted, true);
  assert.deepEqual(Object.keys(res.locals), ["terminal"]);
});

test("a barcode lookup runs no context loader after the terminal read", () => {
  assert.deepEqual(routeHandlers(itemRouter, "/search/barcode"), [
    "searchItemsBarcodeController",
  ]);
  // App level: exactly one terminalMiddleware for every /api request.
  const appRouter = (app as unknown as { router: unknown }).router;
  assert.equal(countNamed(stackOf(appRouter), "terminalMiddleware"), 1);
  assert.equal(countNamed(stackOf(appRouter), "contextMiddleware") > 0, true);
});

test("/api/cloud/post is mounted once and no longer re-runs terminalMiddleware", () => {
  const posts = stackOf(cloudRouter).filter((l) => l.route?.path === "/post");
  assert.equal(posts.length, 1);
  assert.deepEqual(routeHandlers(cloudRouter, "/post"), [
    "contextMiddleware",
    "getCloudPostsController",
  ]);
  assert.equal(countNamed(stackOf(cloudRouter), "terminalMiddleware"), 0);
});

test("withContext loads only what the route asks for", async () => {
  const calls: string[] = [];
  const loaders: ContextLoaders = {
    company: async () => {
      calls.push("company");
      return { id: 1 } as CompanyModel;
    },
    storeSetting: async () => {
      calls.push("storeSetting");
      return { id: 1 } as StoreSettingModel;
    },
    openShift: async (terminalId) => {
      calls.push(`shift:${terminalId}`);
      return null as TerminalShiftModel | null;
    },
  };
  const res = fakeRes();
  res.locals.terminal = { id: 4 };
  await withContext(["storeSetting", "shift"], loaders)(
    {} as Request,
    res,
    (() => {}) as NextFunction,
  );
  assert.deepEqual(calls.sort(), ["shift:4", "storeSetting"]);
  assert.equal(res.locals.shift, null);
  assert.deepEqual(res.locals.storeSetting, { id: 1 });
  assert.equal("company" in res.locals, false);
});

test("single-row cache: one in-flight read, cached value, reload after invalidate", async () => {
  let loads = 0;
  let version = 1;
  const cache = createSingleRowCache(async () => {
    loads++;
    await new Promise((r) => setImmediate(r));
    return { version };
  });

  const [a, b] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(loads, 1, "two concurrent readers share one read");
  assert.equal(a, b);
  await cache.get();
  assert.equal(loads, 1, "cached");

  version = 2;
  cache.invalidate();
  assert.deepEqual(await cache.get(), { version: 2 });
  assert.equal(loads, 2);

  // A read in flight when a save lands must not be cached.
  version = 3;
  cache.invalidate();
  const stale = cache.get();
  cache.invalidate();
  await stale;
  version = 4;
  assert.deepEqual(await cache.get(), { version: 4 });
});

test("saving the store setting invalidates the cache", async () => {
  let loads = 0;
  const cache = createSingleRowCache(async () => {
    loads++;
    return { id: 1, name: `v${loads}` };
  });
  await cache.get();
  const save = createUpdateStoreSettingService(
    { storeSetting: { update: async () => ({ id: 1 }) } },
    () => cache.invalidate(),
  );
  await save({
    name: "Store",
    address1: "1 St",
    suburb: "Eastwood",
    state: "NSW",
    postcode: "2122",
    country: "AU",
  });
  assert.deepEqual(await cache.get(), { id: 1, name: "v2" });
  assert.equal(loads, 2);
});

// ── T-24 review (P1): every route whose controller reads a context value
// mounts the loader for it; /api/shift/close reaches the close transaction
// with only what terminalMiddleware + userMiddleware set. ─────────────────

import shiftRouter from "./shift/shift.router";
import saleRouter from "./sale/sale.router";
import terminalRouter from "./terminal/terminal.router";
import voucherRouter from "./voucher/voucher.router";
import cashIORouter from "./cashio/cashio.router";
import { defaultShiftCloseDeps } from "./shift/shift.service";

type RouteLayer = {
  name?: string;
  method?: string;
  handle: ((req: Request, res: Response, next: NextFunction) => unknown) & {
    contextNeeds?: string[];
  };
};

function routeLayers(router: unknown, method: string, path: string): RouteLayer[] {
  const layer = stackOf(router).find(
    (l) => l.route?.path === path && (l.route.stack as RouteLayer[]).some((s) => s.method === method),
  );
  assert.ok(layer?.route, `${method.toUpperCase()} ${path} exists`);
  return (layer.route.stack as RouteLayer[]).filter((s) => !s.method || s.method === method);
}

function contextNeedsOf(router: unknown, method: string, path: string): string[] {
  return routeLayers(router, method, path).flatMap((l) => l.handle.contextNeeds ?? []).sort();
}

test("context audit: each controller's res.locals reads have a loader on its route", () => {
  // [router, method, path, what the controller reads beyond terminal/user]
  const table: Array<[unknown, string, string, string[]]> = [
    [saleRouter, "post", "/", ["shift", "storeSetting"]],
    [saleRouter, "post", "/spend", ["shift", "storeSetting"]],
    [saleRouter, "post", "/refund", ["shift", "storeSetting"]],
    [saleRouter, "post", "/repay", ["shift", "storeSetting"]],
    [shiftRouter, "post", "/open", ["company"]],
    [shiftRouter, "post", "/close/data", ["shift"]],
    [shiftRouter, "post", "/close", []], // close finds and locks the shift itself
    [terminalRouter, "get", "/me", ["company"]],
    [cloudRouter, "get", "/post", ["company"]],
    [voucherRouter, "post", "/daily/issue", ["storeSetting"]],
    [cashIORouter, "post", "/", ["shift"]],
  ];
  for (const [router, method, path, needs] of table) {
    assert.deepEqual(contextNeedsOf(router, method, path), needs, `${method} ${path}`);
  }
});

async function runRoute(layers: RouteLayer[], req: Request, res: Response) {
  for (const layer of layers) {
    let nexted = false;
    await layer.handle(req, res, ((err?: unknown) => {
      if (err) throw err;
      nexted = true;
    }) as NextFunction);
    if (!nexted) return; // the controller answered
  }
}

test("POST /api/shift/close reaches the close transaction with terminal + user only", async () => {
  const layers = routeLayers(shiftRouter, "post", "/close").map((l) =>
    l.name === "userMiddleware"
      ? {
          ...l,
          handle: (_req: Request, res: Response, next: NextFunction) => {
            res.locals.user = { id: 9, name: "Kim", scope: ["shift"] };
            next();
          },
        }
      : l,
  );
  assert.deepEqual(
    layers.map((l) => l.name),
    ["userMiddleware", "<anonymous>", "closeTerminalShiftController"],
  );

  const saved = { ...defaultShiftCloseDeps };
  let transactions = 0;
  defaultShiftCloseDeps.transaction = (async () => {
    transactions++;
    return { id: 3, closedAt: new Date() };
  }) as typeof defaultShiftCloseDeps.transaction;
  defaultShiftCloseDeps.afterClose = () => {};
  defaultShiftCloseDeps.countOpenCustomerVoucherOperations = async () => 0;

  let status = 0;
  let body: unknown = null;
  const res = {
    locals: { terminal: { id: 1, name: "T1" } }, // what terminalMiddleware sets
    status(code: number) {
      status = code;
      return this;
    },
    json(b: unknown) {
      body = b;
      return this;
    },
  } as unknown as Response;
  try {
    await runRoute(layers, { body: { endedCashActual: 0 } } as Request, res);
  } finally {
    Object.assign(defaultShiftCloseDeps, saved);
  }
  assert.equal(transactions, 1, "close transaction reached");
  assert.equal(status, 200);
  assert.equal((body as { ok: boolean }).ok, true);
});

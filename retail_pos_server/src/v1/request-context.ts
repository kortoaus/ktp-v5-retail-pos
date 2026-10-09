import { NextFunction, Request, Response } from "express";
import type {
  CompanyModel,
  StoreSettingModel,
  TerminalShiftModel,
} from "../generated/prisma/models";
import db from "../libs/db";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../libs/exceptions";

// T-24 (audit R-11) — optional request context, loaded only by the routes that
// use it. `terminalMiddleware` identifies the terminal (one read); a route that
// needs the company, the store setting or the terminal's open shift says so:
//
//   router.post("/", userMiddleware, scopeMiddleware("sale"),
//               withContext(["storeSetting", "shift"]), controller);
//
// Company and StoreSetting are single rows (id 1) that change only on a store
// setting save or a cloud Sync, so they are cached in-process; both events
// call invalidateStoreContextCache(). The open shift is read per request.

// ── Single-row cache (single in-flight read, invalidation-safe) ──────────

export interface SingleRowCache<T> {
  get(): Promise<T | null>;
  invalidate(): void;
}

export function createSingleRowCache<T>(
  load: () => Promise<T | null>,
): SingleRowCache<T> {
  let value: T | null = null;
  let inflight: Promise<T | null> | null = null;
  let generation = 0;

  return {
    get() {
      if (value != null) return Promise.resolve(value);
      if (inflight) return inflight;
      const myGeneration = generation;
      const p = load().then(
        (row) => {
          // A save/sync that happened while this read was in flight wins:
          // do not cache a row read before it.
          if (myGeneration === generation && row != null) value = row;
          if (inflight === p) inflight = null;
          return row;
        },
        (e: unknown) => {
          if (inflight === p) inflight = null;
          throw e;
        },
      );
      inflight = p;
      return p;
    },
    invalidate() {
      generation++;
      value = null;
      inflight = null;
    },
  };
}

export const storeSettingCache = createSingleRowCache<StoreSettingModel>(() =>
  db.storeSetting.findUnique({ where: { id: 1 } }),
);

export const companyCache = createSingleRowCache<CompanyModel>(() =>
  db.company.findUnique({ where: { id: 1 } }),
);

// Store setting save and cloud Sync (company migrate upserts both rows).
export function invalidateStoreContextCache(): void {
  storeSettingCache.invalidate();
  companyCache.invalidate();
}

// ── Route-level context loader ────────────────────────────────────────────

export type ContextNeed = "company" | "storeSetting" | "shift";

export interface ContextLoaders {
  company(): Promise<CompanyModel | null>;
  storeSetting(): Promise<StoreSettingModel | null>;
  openShift(terminalId: number): Promise<TerminalShiftModel | null>;
}

export const defaultContextLoaders: ContextLoaders = {
  company: () => companyCache.get(),
  storeSetting: () => storeSettingCache.get(),
  openShift: (terminalId) =>
    db.terminalShift.findFirst({ where: { terminalId, closedAt: null } }),
};

export function withContext(
  needs: ContextNeed[],
  loaders: ContextLoaders = defaultContextLoaders,
) {
  const wants = new Set(needs);
  const middleware = async function contextMiddleware(
    _req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const terminal = res.locals.terminal as { id: number } | undefined;
      const [company, storeSetting, shift] = await Promise.all([
        wants.has("company") ? loaders.company() : undefined,
        wants.has("storeSetting") ? loaders.storeSetting() : undefined,
        wants.has("shift") && terminal ? loaders.openShift(terminal.id) : undefined,
      ]);
      if (wants.has("company")) {
        if (!company) throw new NotFoundException("Company not configured!");
        res.locals.company = company;
      }
      if (wants.has("storeSetting")) {
        if (!storeSetting) throw new NotFoundException("Store setting not found");
        res.locals.storeSetting = storeSetting;
      }
      // An absent open shift stays null — each controller answers it.
      if (wants.has("shift")) res.locals.shift = shift ?? null;
      next();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      console.error("Request context error:", e);
      throw new InternalServerException("Internal server error");
    }
  };
  // Introspectable for the route audit test (request-context.test.ts).
  return Object.assign(middleware, { contextNeeds: [...wants] as ContextNeed[] });
}

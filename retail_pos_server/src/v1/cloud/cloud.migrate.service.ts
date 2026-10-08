import { Company } from "../../generated/prisma/client";
import apiService from "../../libs/cloud.api";
import db from "../../libs/db";
import { BadRequestException, HttpException } from "../../libs/exceptions";
import {
  cloudBrandMigrate,
  cloudHotkeyMigrate,
  cloudItemMigrate,
  cloudPriceMigrate,
  cloudPromoPriceMigrate,
  MigrateDeps,
  normalizeBarcodes,
  tag,
} from "./cloud.migrate.core";

// Catalog feeds: cursor in CloudSyncCursor, one transaction per batch, cursor
// advanced after commit — see cloud.migrate.core.ts (T-16 / D-12).
const deps: MigrateDeps = { db, api: apiService };

// Same contract as before T-16: true on success, false on a non-HTTP error
// (logged), HttpException (cloud said !ok) re-thrown to the error handler.
async function guard(label: string, run: () => Promise<unknown>) {
  try {
    await run();
    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error(`${tag} ${label}: error`, e);
    return false;
  }
}

export function cloudItemMigrateService() {
  return guard("items", () => cloudItemMigrate(deps));
}

export function cloudBrandMigrateService() {
  return guard("brands", () => cloudBrandMigrate(deps));
}

export function cloudPriceMigrateService() {
  return guard("prices", () => cloudPriceMigrate(deps));
}

export function cloudPromoPriceMigrateService() {
  return guard("promo-prices", () => cloudPromoPriceMigrate(deps));
}

export function cloudHotkeyMigrateService() {
  return guard("hotkeys", () => cloudHotkeyMigrate(deps));
}

export function normalizeBarcodesService() {
  return guard("barcodes", () => normalizeBarcodes(db));
}

// Company is pulled whole on every sync (no lastUpdatedAt, no cursor).
export async function cloudCompanyMigrateService() {
  try {
    const { ok, msg, result } = await apiService.post<Company>(
      "/device/migrate/company",
    );
    if (!ok || !result) {
      throw new BadRequestException(
        msg || "Failed to migrate company from cloud",
      );
    }

    await db.company.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        cloudId: result.cloudId,
        name: result.name,
        phone: result.phone,
        address1: result.address1,
        address2: result.address2,
        suburb: result.suburb,
        state: result.state,
        postcode: result.postcode,
        country: result.country,
        abn: result.abn,
        website: result.website,
        email: result.email,
      },
      update: {
        cloudId: result.cloudId,
        name: result.name,
        phone: result.phone,
        address1: result.address1,
        address2: result.address2,
        suburb: result.suburb,
        state: result.state,
        postcode: result.postcode,
        country: result.country,
        abn: result.abn,
        website: result.website,
        email: result.email,
      },
    });

    await db.storeSetting.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        companyId: result.cloudId,
        companyName: result.name,
        name: result.name,
        phone: result.phone,
        address1: result.address1,
        address2: result.address2,
        suburb: result.suburb,
        state: result.state,
        postcode: result.postcode,
        country: result.country,
        abn: result.abn,
        website: result.website,
        email: result.email,
      },
      update: {
        // create 뿐 아니라 재싱크 때도 stale companyId 를 교정한다
        companyId: result.cloudId,
        companyName: result.name,
      },
    });

    console.log(`${tag} company: synced`);
    return true;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error(`${tag} company: error`, e);
    return false;
  }
}

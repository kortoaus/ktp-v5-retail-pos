import { Response, Request } from "express";
import {
  cloudBrandMigrateService,
  cloudCompanyMigrateService,
  cloudHotkeyMigrateService,
  cloudItemMigrateService,
  cloudPriceMigrateService,
  cloudPromoPriceMigrateService,
  normalizeBarcodesService,
} from "./cloud.migrate.service";

import { getIO } from "../../libs/socket";
import {
  triggerSyncAllSaleInvoices,
  triggerSyncAllShifts,
} from "./cloud.sync.service";
import { triggerSyncPendingOrderCollects } from "../order/order.collect.service";
import { triggerSyncMemberAnonymizeEvents } from "./cloud.member-anonymize.service";
import { createCoalescedRunner } from "./cloud.migrate.runner";
import { invalidateStoreContextCache } from "../request-context";

type SyncOutcome = { ok: true } | { ok: false; msg: string };

// Order matters: brands before items (FK), items before prices/promos/hotkeys.
const STEPS: [() => Promise<boolean>, string][] = [
  [cloudCompanyMigrateService, "Failed to migrate company data"],
  [cloudBrandMigrateService, "Failed to migrate brands"],
  [cloudItemMigrateService, "Failed to migrate items"],
  [cloudPriceMigrateService, "Failed to migrate prices"],
  [cloudPromoPriceMigrateService, "Failed to migrate promo prices"],
  [normalizeBarcodesService, "Failed to normalize barcodes"],
  [cloudHotkeyMigrateService, "Failed to migrate hotkeys"],
];

async function runCatalogSync(): Promise<SyncOutcome> {
  try {
    for (const [step, msg] of STEPS) {
      if (!(await step())) return { ok: false, msg };
    }
  } finally {
    // T-24 (R-11) — company migrate upserts Company + StoreSetting (even when
    // a later step fails): drop the in-process cache either way.
    invalidateStoreContextCache();
  }

  triggerSyncAllSaleInvoices();
  triggerSyncAllShifts();
  // S3 — 미확인 주문 collect 도 같은 트리거에서 스윕.
  triggerSyncPendingOrderCollects();
  // D3 — 멤버 익명화 이벤트 pull 도 카탈로그 싱크에 편승 (member-deletion §5).
  triggerSyncMemberAnonymizeEvents();

  getIO().emit("cloud-sync-completed");
  return { ok: true };
}

// One pipeline at a time; a request made during a run waits for it and shares
// one coalesced follow-up run (F-15, see cloud.migrate.runner.ts). An
// HttpException from a step rejects every request waiting on that run.
const runCatalogSyncExclusive = createCoalescedRunner(runCatalogSync);

export async function cloudItemMigrateController(req: Request, res: Response) {
  const outcome = await runCatalogSyncExclusive();
  if (!outcome.ok) {
    res.status(500).json({ ok: false, msg: outcome.msg });
    return;
  }
  res.status(200).json({
    ok: true,
    msg: "Migrated all data from cloud",
  });
}

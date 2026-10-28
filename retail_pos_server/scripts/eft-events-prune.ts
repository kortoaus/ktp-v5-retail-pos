// bun run eft:prune [--days N] — delete EftEvent rows older than N days
// (default EFT_EVENT_RETENTION_DAYS, 180). retail-eftpos S-3 A-3: no cron is
// installed; run by hand or from an ops script. Writes to the store DB named by
// DATABASE_URL — check it before running.
import { loadEftConfig } from "../src/v1/eft/eft.config";
import { pruneEftEvents } from "../src/v1/eft/eft.store.prisma";

const i = process.argv.indexOf("--days");
const days = i > 0 ? Number(process.argv[i + 1]) : loadEftConfig().eventRetentionDays;

pruneEftEvents(days)
  .then((count) => {
    console.log(`[eft] pruned ${count} EftEvent rows older than ${days} days`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[eft] prune failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });

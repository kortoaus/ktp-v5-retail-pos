// In-process serialisation of the catalog Sync pipeline (T-16 review F-15).
//
// Two tills can press Sync at the same time. Running the feeds concurrently
// would let an older cloud response overwrite rows a newer run already stored
// while the newer run's cursor stays — rows the cursor would never re-pull.
// The pipeline therefore runs one at a time:
//   - no run in flight  → start one;
//   - a run in flight   → wait for it, then share ONE follow-up run with every
//                         other caller that arrived meanwhile (coalesced), so a
//                         request always gets the result of a run that started
//                         after it was made — never a spurious "already running".
// The per-feed `SELECT … FOR UPDATE` on CloudSyncCursor (cloud.migrate.core.ts)
// is the second line of defence for anything outside this process.

export function createCoalescedRunner<R>(fn: () => Promise<R>): () => Promise<R> {
  let running: Promise<R> | null = null;
  let queued: Promise<R> | null = null;

  const run = (): Promise<R> => {
    if (!running) {
      running = fn().finally(() => {
        running = null;
      });
      return running;
    }
    if (!queued) {
      queued = running
        .then(
          () => undefined,
          () => undefined,
        )
        .then(() => {
          queued = null;
          return run();
        });
    }
    return queued;
  };

  return run;
}

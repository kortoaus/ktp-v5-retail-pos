// T-24 (audit R-5 + R-18) — one small runner for the three upload sweeps
// (sale invoices, closed shifts, C&C order collects).
//
// What it guarantees:
//   - Coalesced triggers. A trigger that arrives while a run is in flight sets
//     a rerun flag; the run then repeats exactly once, however many triggers
//     arrived. Work committed after a run's first page query is never left
//     waiting for an unrelated later trigger.
//   - Bounded pages. Each run walks pending rows in id order, `pageSize` rows
//     at a time (keyset on id), so memory and query payload stay flat after an
//     outage instead of growing with the backlog.
//   - Timed retry. When a run ends with failures (or a halt, e.g. the cloud is
//     unreachable), a retry is scheduled with backoff 1 → 2 → 5 → 10 min (cap);
//     a clean run resets the backoff and clears the timer.
//   - Visibility. One log line per run: done / failed / deferred, how many rows
//     are still pending and the age of the oldest one, and the retry delay.

export const SWEEP_PAGE_SIZE = 50;
export const SWEEP_BACKOFF_MS = [60_000, 120_000, 300_000, 600_000] as const;

export interface SweepPageResult {
  done: number; // pushed / settled rows
  deferred: number; // left pending on purpose (e.g. parent not synced yet)
  failed: number; // attempted and failed — keeps the row pending
  halted: boolean; // stop this run now (cloud unreachable / throttled)
}

export interface SweepPendingStats {
  count: number;
  oldestAt: Date | null;
}

export interface SweepSource<Row extends { id: number }> {
  name: string;
  // Pending rows with id > afterId, ordered by id asc, at most `limit`.
  loadPage(afterId: number, limit: number): Promise<Row[]>;
  processPage(rows: Row[]): Promise<SweepPageResult>;
  pendingStats(): Promise<SweepPendingStats>;
}

export interface SweepRunStats {
  pages: number;
  done: number;
  deferred: number;
  failed: number;
  halted: boolean;
  error: boolean; // the run threw (DB error etc.)
}

type TimerHandle = unknown;

export interface SweepRunnerOptions {
  pageSize?: number;
  backoffMs?: readonly number[];
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  now?: () => number;
  log?: (line: string) => void;
}

export interface SweepRunner {
  // Fire-and-forget entry point; the promise settles when the current cycle
  // (including a coalesced rerun) is over. It never rejects.
  trigger(): Promise<void>;
  // Test/inspection helpers.
  isRetryScheduled(): boolean;
  nextRetryMs(): number | null;
  stop(): void;
}

function defaultSetTimer(fn: () => void, ms: number): TimerHandle {
  const t = setTimeout(fn, ms);
  // Never keep the process alive just for a retry.
  if (typeof t === "object" && t && "unref" in t) t.unref();
  return t;
}

function defaultClearTimer(handle: TimerHandle) {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

export function formatAge(ms: number | null): string {
  if (ms == null) return "-";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 120) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

export function createSweepRunner<Row extends { id: number }>(
  source: SweepSource<Row>,
  options: SweepRunnerOptions = {},
): SweepRunner {
  const pageSize = options.pageSize ?? SWEEP_PAGE_SIZE;
  const backoff = options.backoffMs ?? SWEEP_BACKOFF_MS;
  const setTimer = options.setTimer ?? defaultSetTimer;
  const clearTimer = options.clearTimer ?? defaultClearTimer;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));

  let running: Promise<void> | null = null;
  let rerunRequested = false;
  let attempt = 0;
  let timer: TimerHandle | null = null;
  let retryDelay: number | null = null;
  let stopped = false;

  function clearRetry() {
    if (timer != null) clearTimer(timer);
    timer = null;
    retryDelay = null;
  }

  function scheduleRetry(): number {
    clearRetry();
    const delay = backoff[Math.min(attempt, backoff.length - 1)];
    attempt++;
    retryDelay = delay;
    timer = setTimer(() => {
      timer = null;
      retryDelay = null;
      void trigger();
    }, delay);
    return delay;
  }

  async function runOnce(): Promise<SweepRunStats> {
    const stats: SweepRunStats = {
      pages: 0,
      done: 0,
      deferred: 0,
      failed: 0,
      halted: false,
      error: false,
    };
    try {
      let afterId = 0;
      for (;;) {
        const rows = await source.loadPage(afterId, pageSize);
        if (rows.length === 0) break;
        stats.pages++;
        const res = await source.processPage(rows);
        stats.done += res.done;
        stats.deferred += res.deferred;
        stats.failed += res.failed;
        if (res.halted) {
          stats.halted = true;
          break;
        }
        afterId = rows[rows.length - 1].id;
        if (rows.length < pageSize) break;
      }
    } catch (e) {
      stats.error = true;
      console.error(`[sweep:${source.name}] run threw:`, e);
    }
    return stats;
  }

  async function logRun(stats: SweepRunStats, retryMs: number | null) {
    let pending = "?";
    let oldest = "?";
    try {
      const p = await source.pendingStats();
      pending = String(p.count);
      oldest = formatAge(p.oldestAt ? now() - p.oldestAt.getTime() : null);
    } catch {
      // stats are best-effort — the line still goes out
    }
    log(
      `[sweep:${source.name}] done=${stats.done} failed=${stats.failed} deferred=${stats.deferred}` +
        ` pages=${stats.pages} pending=${pending} oldestPendingAge=${oldest}` +
        (stats.halted ? " halted" : "") +
        (stats.error ? " error" : "") +
        (retryMs != null ? ` retryIn=${formatAge(retryMs)}` : ""),
    );
  }

  function trigger(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) {
      rerunRequested = true;
      return running;
    }
    running = (async () => {
      try {
        for (;;) {
          rerunRequested = false;
          const stats = await runOnce();
          if (rerunRequested && !stopped) {
            await logRun(stats, null);
            continue; // exactly one more pass covers every trigger so far
          }
          let retryMs: number | null = null;
          if (stats.failed > 0 || stats.halted || stats.error) {
            if (!stopped) retryMs = scheduleRetry();
          } else {
            attempt = 0;
            clearRetry();
          }
          await logRun(stats, retryMs);
          break;
        }
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    trigger,
    isRetryScheduled: () => timer != null,
    nextRetryMs: () => retryDelay,
    stop: () => {
      stopped = true;
      clearRetry();
    },
  };
}

// A failed cloud answer that says nothing about this one row — the cloud is
// unreachable, timed out, throttled, failing or refusing our key — stops the
// run: the next rows would fail the same way, each after up to 30 s. A plain
// 4xx about this row (or ok:false without a transport problem) does not.
export function isHaltingCloudFailure(res: {
  ok: boolean;
  status?: number;
  transport?: "timeout" | "network";
}): boolean {
  if (res.ok) return false;
  if (res.transport) return true;
  const s = res.status;
  if (s == null || s === 0 || s >= 500) return true;
  return s === 401 || s === 403 || s === 408 || s === 429;
}

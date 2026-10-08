// T-24 (audit R-17) — one shared store-setting value for every
// useStoreSetting() consumer (App, PaymentModal, voucher search, Invoice
// viewer, Orders, price tags, …): a single in-flight GET, one shared value,
// invalidated on a setting save (StoreSettingScreen) and after a cloud Sync
// (`cloud-sync-completed`). A value older than maxAgeMs is refetched on the
// next mount, so a save made on another till shows up within minutes.
// Pure (no React) so it is unit-tested under node.

export interface StoreSettingSnapshot<T> {
  value: T | null;
  loading: boolean;
}

export interface StoreSettingCache<T> {
  getSnapshot(): StoreSettingSnapshot<T>;
  subscribe(listener: () => void): () => void;
  ensure(): Promise<void>; // load unless a fresh value or a load is in hand
  reload(): Promise<void>; // fetch now (shares a load already in flight)
  invalidate(): void; // drop freshness; refetch now if anyone is mounted
}

export const STORE_SETTING_MAX_AGE_MS = 5 * 60_000;

export function createStoreSettingCache<T>(
  fetcher: () => Promise<{ ok: boolean; result?: T | null }>,
  options: { maxAgeMs?: number; now?: () => number } = {},
): StoreSettingCache<T> {
  const maxAgeMs = options.maxAgeMs ?? STORE_SETTING_MAX_AGE_MS;
  const now = options.now ?? Date.now;
  let snapshot: StoreSettingSnapshot<T> = { value: null, loading: true };
  let loadedAt: number | null = null;
  let inflight: Promise<void> | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();

  const set = (next: StoreSettingSnapshot<T>) => {
    if (next.value === snapshot.value && next.loading === snapshot.loading) return;
    snapshot = next;
    listeners.forEach((l) => l());
  };

  const load = (): Promise<void> => {
    if (inflight) return inflight;
    const myGeneration = ++generation;
    set({ value: snapshot.value, loading: true });
    const p = (async () => {
      try {
        const res = await fetcher();
        if (myGeneration !== generation) return; // superseded by invalidate
        loadedAt = now();
        set({ value: res.ok && res.result ? res.result : snapshot.value, loading: false });
      } catch {
        if (myGeneration === generation) set({ value: snapshot.value, loading: false });
      }
    })();
    inflight = p;
    void p.then(() => {
      if (inflight === p) inflight = null;
    });
    return p;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ensure() {
      if (inflight) return inflight;
      if (loadedAt != null && now() - loadedAt < maxAgeMs) return Promise.resolve();
      return load();
    },
    reload: () => load(),
    invalidate() {
      loadedAt = null;
      if (inflight) {
        // the answer in flight may predate the change — fetch again
        inflight = null;
        generation++;
      }
      if (listeners.size > 0) void load();
    },
  };
}

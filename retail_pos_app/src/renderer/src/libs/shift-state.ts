// The till's current-shift state (T-10 review round 3). No DOM, no React: a
// tiny store ShiftContext subscribes to (useSyncExternalStore), so the rules
// below are unit-tested in node.
//
//  - Latest-read ownership: every read of GET /api/shift/current takes a
//    sequence number; only the newest read may write the state. An older,
//    slower answer (e.g. the boot read) can never overwrite what a later
//    successful Retry learnt, so a rejected shift id cannot come back.
//  - In-place reloads: the mismatch recovery / Retry reload does not raise
//    `loading` (Gateway would unmount the Close Shift screen and its Retry /
//    Home controls); the current shift stays until the answer arrives.
//    Only the terminal's first read and the post-open read are full loads.
//  - Stale marker: set on a 409 SHIFT_MISMATCH (libs/shift-close.ts), cleared
//    by a successful reload — and when the terminal identity changes (the
//    marker belonged to the old terminal's shift).

export interface ShiftStateSnapshot<S> {
  shift: S | null;
  // A full load is in flight (Gateway shows its loading screen).
  loading: boolean;
  staleShiftId: number | null;
}

export interface ShiftStateStore<S> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ShiftStateSnapshot<S>;
  // The terminal the state belongs to (called on every terminal refresh, as
  // the old effect did): an id change drops the stale marker; with a
  // terminal it starts a full load, without one it ends loading.
  setTerminal(terminalId: number | null): Promise<boolean>;
  // Re-read the current shift. Resolves true only when THIS read answered ok
  // and was still the newest read (it then owns the state).
  reload(options?: { inPlace?: boolean }): Promise<boolean>;
  setShift(shift: S | null): void;
  setStaleShiftId(id: number | null): void;
}

export function createShiftStateStore<S>(
  fetchCurrent: () => Promise<{ ok: boolean; result?: S | null }>,
  log: (e: unknown) => void = () => {},
): ShiftStateStore<S> {
  let snapshot: ShiftStateSnapshot<S> = { shift: null, loading: true, staleShiftId: null };
  let terminalId: number | null | undefined = undefined;
  let readSeq = 0;
  const listeners = new Set<() => void>();

  const update = (patch: Partial<ShiftStateSnapshot<S>>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  };

  const reload: ShiftStateStore<S>["reload"] = async ({ inPlace = false } = {}) => {
    const seq = ++readSeq;
    if (!inPlace && !snapshot.loading) update({ loading: true });
    let ok = false;
    let next: S | null = null;
    try {
      const res = await fetchCurrent();
      ok = res.ok;
      next = res.result ?? null;
    } catch (e) {
      log(e);
      ok = false;
    }
    if (seq !== readSeq) return false; // a newer read owns the state
    update(ok ? { shift: next, loading: false } : { loading: false });
    return ok;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    async setTerminal(next) {
      const changed = terminalId !== undefined && next !== terminalId;
      terminalId = next;
      if (changed && snapshot.staleShiftId != null) update({ staleShiftId: null });
      if (next == null) {
        readSeq++; // any read for the old terminal no longer owns the state
        update({ loading: false });
        return true;
      }
      return reload();
    },
    reload,
    setShift: (shift) => update({ shift }),
    setStaleShiftId: (id) => {
      if (snapshot.staleShiftId !== id) update({ staleShiftId: id });
    },
  };
}

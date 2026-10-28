// In-process long-poll waiters keyed by transaction id (D-4). Every lane
// version bump calls notify(); a held GET wakes, re-reads the row and answers.
export class VersionWaiters {
  private readonly waiting = new Map<string, Set<() => void>>();

  notify(id: string): void {
    const set = this.waiting.get(id);
    if (!set) return;
    this.waiting.delete(id);
    for (const wake of set) wake();
  }

  /** Resolves on notify, after `ms`, or when `signal` aborts — whichever first. */
  wait(id: string, ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let set = this.waiting.get(id);
      if (!set) {
        set = new Set();
        this.waiting.set(id, set);
      }
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        const s = this.waiting.get(id);
        if (s) {
          s.delete(done);
          if (s.size === 0) this.waiting.delete(id);
        }
        resolve();
      };
      const timer = setTimeout(done, ms);
      set.add(done);
      if (signal) {
        if (signal.aborted) done();
        else signal.addEventListener("abort", done, { once: true });
      }
    });
  }

  size(): number {
    let n = 0;
    for (const s of this.waiting.values()) n += s.size;
    return n;
  }
}

// PAY ON TERMINAL start guard (retail-eftpos T-7 round 1: F-13, F-14, A-29).
// The create may only go out with a sale attempt id that is durably stored —
// otherwise a lost answer plus a second tap would send a *different* id and
// bypass the server's idempotency (a second charge). And a start that is
// still waiting on that storage when the panel closes must never send.
//   - one start at a time (synchronous guard, taken before any await);
//   - mint → persist → read back: the stored id must equal the minted one;
//   - cancel() (panel closed / unmounted) and `stillValid()` (same cart,
//     same session, nothing else running) are re-checked right before send.
// Pure; the PaymentModal wires it to libs/operation-id.ts.

export type EftStartResult = "sent" | "busy" | "not-durable" | "abandoned";

export const NOT_DURABLE_MESSAGE = "Could not save the payment attempt on this till — the card payment was not sent [POS]";

export interface EftStarterDeps {
  /** Mint or reuse the attempt id (operation-id.ts operationIdFor). */
  mint(attemptKey: string): string;
  /** Make the attempt durable; throws when it could not (Runner: flush to AsyncStorage). */
  persist(attemptKey: string): Promise<void>;
  /** The stored attempt id read back (operation-id.ts pendingOperation), null when none. */
  stored(attemptKey: string): string | null;
}

export function createEftStarter(deps: EftStarterDeps) {
  let inFlight = false;
  let generation = 0;
  return {
    isStarting: () => inFlight,
    async start(
      attemptKey: string,
      stillValid: () => boolean,
      send: (operationId: string) => void,
    ): Promise<EftStartResult> {
      if (inFlight) return "busy";
      inFlight = true;
      const gen = ++generation;
      try {
        let operationId: string;
        try {
          operationId = deps.mint(attemptKey);
          await deps.persist(attemptKey);
        } catch {
          return "not-durable";
        }
        if (deps.stored(attemptKey) !== operationId) return "not-durable";
        if (gen !== generation || !stillValid()) return "abandoned";
        send(operationId);
        return "sent";
      } finally {
        inFlight = false;
      }
    },
    /** The panel closed / unmounted: a start still waiting on storage never sends. */
    cancel(): void {
      generation++;
    },
  };
}

export type EftStarter = ReturnType<typeof createEftStarter>;

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  getCurrentShift,
  openShift as openShiftApi,
  closeShift as closeShiftApi,
  type CloseShiftDTO,
} from "../service/shift.service";
import { TerminalShift } from "../types/models";
import {
  closeShiftGuarded,
  openShiftWithRecovery,
  reloadStaleShift,
  type ShiftMismatch,
} from "../libs/shift-close";
import { createShiftStateStore } from "../libs/shift-state";
import { useTerminal } from "./TerminalContext";

interface OpenShiftPayload {
  openedNote: string;
  cashInDrawer: number;
  getBackItemIds: number[];
  getBackOptionIds: number[];
  isPublicHoliday: boolean;
}

interface ShiftContextValue {
  shift: TerminalShift | null;
  loading: boolean;
  // T-10 review round 5: a 400 "Shift already opened" re-reads the shift in
  // place (alreadyOpen: true) so Home / Close Shift recover.
  openShift: (
    payload: OpenShiftPayload,
  ) => Promise<{ ok: boolean; msg: string; alreadyOpen?: boolean }>;
  // T-10 review: on 409 SHIFT_MISMATCH the shift is reloaded from the server
  // before this resolves; `mismatch` tells the screen to reset its count.
  closeShift: (
    dto: CloseShiftDTO,
  ) => Promise<{
    ok: boolean;
    msg: string;
    mismatch?: ShiftMismatch;
    // true while the shift is known-stale (mismatch, reload not yet ok):
    // no close is sent until retryShiftReload() succeeds.
    stale?: boolean;
  }>;
  // Resolves true only when the server answered with the current shift.
  reloadShift: () => Promise<boolean>;
  // Set after a SHIFT_MISMATCH until a reload succeeds (T-10 review).
  staleShiftId: number | null;
  // false until this terminal's shift was read successfully (boot, or after a
  // terminal change); Close Shift offers Retry and refuses to close meanwhile.
  shiftKnown: boolean;
  retryShiftReload: () => Promise<boolean>;
}

const ShiftContext = createContext<ShiftContextValue | null>(null);

export function ShiftProvider({ children }: { children: ReactNode }) {
  const { terminal, loading: terminalLoading } = useTerminal();
  // T-10 review round 3: state lives in a pure store (libs/shift-state.ts) —
  // latest-read ownership, in-place stale reloads (no full-screen loading),
  // stale marker cleared on a terminal change.
  const [store] = useState(() =>
    createShiftStateStore<TerminalShift>(getCurrentShift, (e) => console.error(e)),
  );
  const { shift, loading, staleShiftId, shiftKnown } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
  );

  useEffect(() => {
    if (terminalLoading) return;
    void store.setTerminal(terminal ? terminal.id : null);
  }, [store, terminal, terminalLoading]);

  // Full load (post-open). Resolves true only when this read answered and
  // still owned the state.
  const reload = useCallback(() => store.reload(), [store]);

  const retryShiftReload = useCallback(
    () =>
      reloadStaleShift({
        reloadShift: () => store.reload({ inPlace: true }),
        setStaleShiftId: store.setStaleShiftId,
      }),
    [store],
  );

  const openShift = useCallback(
    async (payload: OpenShiftPayload) => {
      const outcome = await openShiftWithRecovery(payload, {
        open: openShiftApi,
        reload,
        reloadInPlace: () => store.reload({ inPlace: true }),
      });
      if (outcome.kind === "opened") return { ok: true, msg: "" };
      if (outcome.kind === "already-open")
        return { ok: false, msg: outcome.message, alreadyOpen: true };
      return { ok: false, msg: outcome.message };
    },
    [reload, store],
  );

  const doCloseShift = useCallback(
    async (dto: CloseShiftDTO) => {
      const outcome = await closeShiftGuarded(dto, {
        close: closeShiftApi,
        // In place: the Close Shift screen (Retry / Home) stays mounted.
        reloadShift: () => store.reload({ inPlace: true }),
        onClosed: () => store.setShift(null),
        staleShiftId: () => store.getSnapshot().staleShiftId,
        setStaleShiftId: store.setStaleShiftId,
        shiftKnown: () => store.getSnapshot().shiftKnown,
      });
      if (outcome.kind === "closed") return { ok: true, msg: "" };
      if (outcome.kind === "mismatch")
        return {
          ok: false,
          msg: outcome.message,
          mismatch: outcome.mismatch,
          stale: !outcome.reloaded,
        };
      if (outcome.kind === "stale")
        return { ok: false, msg: outcome.message, stale: true };
      return { ok: false, msg: outcome.message };
    },
    [store],
  );

  return (
    <ShiftContext.Provider
      value={{
        shift,
        loading,
        openShift,
        closeShift: doCloseShift,
        reloadShift: reload,
        staleShiftId,
        shiftKnown,
        retryShiftReload,
      }}
    >
      {children}
    </ShiftContext.Provider>
  );
}

export function useShift(): ShiftContextValue {
  const ctx = useContext(ShiftContext);
  if (!ctx) {
    throw new Error("useShift must be used within ShiftProvider");
  }
  return ctx;
}

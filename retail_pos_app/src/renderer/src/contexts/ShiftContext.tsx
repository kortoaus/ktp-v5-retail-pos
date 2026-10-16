import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
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
  reloadStaleShift,
  type ShiftMismatch,
} from "../libs/shift-close";
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
  openShift: (
    payload: OpenShiftPayload,
  ) => Promise<{ ok: boolean; msg: string }>;
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
  retryShiftReload: () => Promise<boolean>;
}

const ShiftContext = createContext<ShiftContextValue | null>(null);

export function ShiftProvider({ children }: { children: ReactNode }) {
  const { terminal, loading: terminalLoading } = useTerminal();
  const [shift, setShift] = useState<TerminalShift | null>(null);
  const [loading, setLoading] = useState(true);
  const [staleShiftId, setStaleShiftIdState] = useState<number | null>(null);
  // Read synchronously by closeShift (state alone would lag a render).
  const staleRef = useRef<number | null>(null);
  const setStaleShiftId = useCallback((id: number | null) => {
    staleRef.current = id;
    setStaleShiftIdState(id);
  }, []);

  useEffect(() => {
    if (terminalLoading || !terminal) {
      setLoading(false);
      return;
    }

    const init = async () => {
      setLoading(true);
      try {
        const res = await getCurrentShift();
        if (res.ok) {
          setShift(res.result ?? null);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [terminal, terminalLoading]);

  // A failed GET leaves the state as it was and resolves false, so a caller
  // (the mismatch recovery) knows the till did not learn the current shift.
  const reload = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await getCurrentShift();
      if (res.ok) {
        setShift(res.result ?? null);
        return true;
      }
      return false;
    } catch (e) {
      console.error(e);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const retryShiftReload = useCallback(
    () => reloadStaleShift({ reloadShift: reload, setStaleShiftId }),
    [reload, setStaleShiftId],
  );

  const openShift = useCallback(
    async (payload: OpenShiftPayload) => {
      const res = await openShiftApi(payload);
      if (res.ok) {
        await reload();
      }
      return { ok: res.ok, msg: res.msg };
    },
    [reload],
  );

  const doCloseShift = useCallback(
    async (dto: CloseShiftDTO) => {
      const outcome = await closeShiftGuarded(dto, {
        close: closeShiftApi,
        reloadShift: reload,
        onClosed: () => setShift(null),
        staleShiftId: () => staleRef.current,
        setStaleShiftId,
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
    [reload, setStaleShiftId],
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

import {
  createContext,
  useContext,
  useEffect,
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
import { closeShiftGuarded, type ShiftMismatch } from "../libs/shift-close";
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
  ) => Promise<{ ok: boolean; msg: string; mismatch?: ShiftMismatch }>;
  reloadShift: () => Promise<void>;
}

const ShiftContext = createContext<ShiftContextValue | null>(null);

export function ShiftProvider({ children }: { children: ReactNode }) {
  const { terminal, loading: terminalLoading } = useTerminal();
  const [shift, setShift] = useState<TerminalShift | null>(null);
  const [loading, setLoading] = useState(true);

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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCurrentShift();
      if (res.ok) {
        setShift(res.result ?? null);
      }
    } catch {
      setShift(null);
    } finally {
      setLoading(false);
    }
  }, []);

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
      });
      if (outcome.kind === "closed") return { ok: true, msg: "" };
      if (outcome.kind === "mismatch")
        return { ok: false, msg: outcome.message, mismatch: outcome.mismatch };
      return { ok: false, msg: outcome.message };
    },
    [reload],
  );

  return (
    <ShiftContext.Provider
      value={{ shift, loading, openShift, closeShift: doCloseShift, reloadShift: reload }}
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

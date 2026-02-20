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
} from "../service/shift.service";
import { TerminalShift } from "../types/models";
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

  return (
    <ShiftContext.Provider
      value={{ shift, loading, openShift, reloadShift: reload }}
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

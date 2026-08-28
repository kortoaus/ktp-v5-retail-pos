import { useCallback, useEffect, useRef, useState } from "react";
import { QTY_SCALE } from "../libs/constants";

/**
 * The platter, polled.
 *
 * `hooks/useWeight.ts` reads on demand (`WeightModal` presses a button);
 * a weighing station wants the number to move on its own, so this one polls
 * `scale:read-weight` on an interval while it is enabled and unmounts cleanly.
 *
 * Polling rather than a push channel because that is what the IPC offers:
 * `scale:read-weight` is `handle`/`invoke`, and `CasScale` is a
 * request/response driver — it writes `0x57` and parses the reply, so nothing
 * arrives unasked. `DatalogicScale` does stream, but only its barcodes are
 * pushed (`barcode:scan`); its weights are cached and read the same way.
 *
 * 500 ms is the interval `WeightModal` already uses for its auto-poll mode.
 * The in-flight guard matters: a serial read has a 1000 ms timeout, so a
 * disconnected scale answers slower than the interval fires and un-guarded
 * polls would queue up behind each other.
 */

export interface WeightResult {
  weight: number;
  unit: "kg" | "lb" | "oz" | "g";
  status: "stable" | "unstable" | "error" | "disconnected";
  message?: string;
}

const IDLE: WeightResult = { weight: 0, unit: "kg", status: "disconnected" };

export const WEIGHT_POLL_MS = 500;

interface UseLiveWeightReturn {
  weight: WeightResult;
  /** Integer grams — what the label maths works in. */
  weightGrams: number;
  /** Five padded grams (`"01036"`) — `makeLabelData`'s input format. */
  weightString: string;
  reading: boolean;
  /** Force one read now, outside the interval. */
  refresh: () => Promise<void>;
}

export function useLiveWeight(enabled = true): UseLiveWeightReturn {
  const [weight, setWeight] = useState<WeightResult>(IDLE);
  const [reading, setReading] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await window.electronAPI.scaleReadWeight();
      if (mountedRef.current) setWeight(result);
    } catch {
      if (mountedRef.current) {
        setWeight({ weight: 0, unit: "kg", status: "error", message: "Read failed" });
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    setReading(true);
    try {
      await read();
    } finally {
      if (mountedRef.current) setReading(false);
    }
  }, [read]);

  useEffect(() => {
    if (!enabled) {
      setWeight(IDLE);
      return;
    }
    void read();
    const id = setInterval(() => void read(), WEIGHT_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, read]);

  const weightGrams = Math.max(0, Math.round(weight.weight * QTY_SCALE));

  return {
    weight,
    weightGrams,
    weightString: String(weightGrams).padStart(5, "0"),
    reading,
    refresh,
  };
}

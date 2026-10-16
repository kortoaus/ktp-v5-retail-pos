// Shift close with the expected-shift guard (T-10 review). No DOM, no HTTP
// client: the close request and the shift reload are injected (ShiftContext).
//
// The till sends the shift it counted (`expectedShiftId`). When the server's
// open shift is another one — e.g. this shift's close committed but its answer
// was lost and the next shift was opened — the server answers 409
// SHIFT_MISMATCH with the current open shift id (or null) and closes nothing.
// The till then reloads its shift from the server, so the next press targets
// the shift that is open now (after a fresh count), never the stale id again.

export const SHIFT_MISMATCH = "SHIFT_MISMATCH";

export interface ShiftMismatch {
  expectedShiftId: number;
  currentOpenShiftId: number | null;
}

export interface CloseShiftAnswer {
  ok: boolean;
  msg: string;
  result?: unknown;
}

export type CloseShiftOutcome =
  | { kind: "closed" }
  | { kind: "mismatch"; mismatch: ShiftMismatch; message: string }
  | { kind: "failed"; message: string };

export function shiftMismatchOf(res: CloseShiftAnswer): ShiftMismatch | null {
  if (res.ok || !res.result || typeof res.result !== "object") return null;
  const r = res.result as Record<string, unknown>;
  if (r.code !== SHIFT_MISMATCH || typeof r.expectedShiftId !== "number") return null;
  return {
    expectedShiftId: r.expectedShiftId,
    currentOpenShiftId: typeof r.currentOpenShiftId === "number" ? r.currentOpenShiftId : null,
  };
}

export function shiftMismatchMessage(m: ShiftMismatch): string {
  return m.currentOpenShiftId == null
    ? `Shift ${m.expectedShiftId} is no longer open. No shift is open on this terminal now — nothing was closed.`
    : `Shift ${m.expectedShiftId} is no longer open. Shift ${m.currentOpenShiftId} is open now — nothing was closed. Count the drawer again to close shift ${m.currentOpenShiftId}.`;
}

export async function closeShiftGuarded<B extends { expectedShiftId?: number }>(
  body: B,
  deps: {
    close(body: B): Promise<CloseShiftAnswer>;
    // Re-read the terminal's current shift from the server into till state.
    reloadShift(): Promise<void>;
    onClosed(): void;
  },
  fallbackMessage = "Failed to close shift",
): Promise<CloseShiftOutcome> {
  const res = await deps.close(body);
  if (res.ok) {
    deps.onClosed();
    return { kind: "closed" };
  }
  const mismatch = shiftMismatchOf(res);
  if (mismatch) {
    await deps.reloadShift();
    return { kind: "mismatch", mismatch, message: shiftMismatchMessage(mismatch) };
  }
  return { kind: "failed", message: res.msg || fallbackMessage };
}

// Shift close with the expected-shift guard (T-10 review). No DOM, no HTTP
// client: the close request and the shift reload are injected (ShiftContext).
//
// The till sends the shift it counted (`expectedShiftId`). When the server's
// open shift is another one — e.g. this shift's close committed but its answer
// was lost and the next shift was opened — the server answers 409
// SHIFT_MISMATCH with the current open shift id (or null) and closes nothing.
// The till then reloads its shift from the server, so the next press targets
// the shift that is open now (after a fresh count), never the stale id again.
//
// Stale state (T-10 review round 2): from the mismatch until a reload
// SUCCEEDS the till's shift is known-stale (`staleShiftId`). A failed reload
// (network, server down) leaves it stale; every close is refused without a
// request until a Retry reload succeeds, so the rejected id is never resent.

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

export const SHIFT_RELOAD_FAILED_MESSAGE = "Could not reload the shift — Retry";

export type CloseShiftOutcome =
  | { kind: "closed" }
  // reloaded: false → the till is still stale (Retry needed before a close).
  | { kind: "mismatch"; mismatch: ShiftMismatch; reloaded: boolean; message: string }
  // Refused while stale: nothing was sent.
  | { kind: "stale"; message: string }
  | { kind: "failed"; message: string };

export interface ShiftCloseDeps<B> {
  close(body: B): Promise<CloseShiftAnswer>;
  // Re-read the terminal's current shift from the server into till state;
  // resolves true only when the server answered.
  reloadShift(): Promise<boolean>;
  onClosed(): void;
  staleShiftId(): number | null;
  setStaleShiftId(id: number | null): void;
}

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

// Reload after a mismatch (and the screen's Retry): clears the stale mark only
// when the reload succeeded.
export async function reloadStaleShift(
  deps: Pick<ShiftCloseDeps<unknown>, "reloadShift" | "setStaleShiftId">,
): Promise<boolean> {
  let reloaded = false;
  try {
    reloaded = await deps.reloadShift();
  } catch {
    reloaded = false;
  }
  if (reloaded) deps.setStaleShiftId(null);
  return reloaded;
}

export async function closeShiftGuarded<B extends { expectedShiftId?: number }>(
  body: B,
  deps: ShiftCloseDeps<B>,
  fallbackMessage = "Failed to close shift",
): Promise<CloseShiftOutcome> {
  if (deps.staleShiftId() != null)
    return { kind: "stale", message: SHIFT_RELOAD_FAILED_MESSAGE };
  const res = await deps.close(body);
  if (res.ok) {
    deps.onClosed();
    return { kind: "closed" };
  }
  const mismatch = shiftMismatchOf(res);
  if (mismatch) {
    deps.setStaleShiftId(mismatch.expectedShiftId);
    const reloaded = await reloadStaleShift(deps);
    const message = shiftMismatchMessage(mismatch);
    return {
      kind: "mismatch",
      mismatch,
      reloaded,
      message: reloaded ? message : `${message} ${SHIFT_RELOAD_FAILED_MESSAGE}.`,
    };
  }
  return { kind: "failed", message: res.msg || fallbackMessage };
}

// ── Close Shift screen view (T-10 review round 3) ───────────────────────────
// What the screen renders, independent of React. The header (Cancel) and the
// stale banner (Retry / Home) never wait for the closing preview: a failed
// preview (by design when no shift is open) shows a message with Home, never
// an endless "Loading".
export type ClosePreviewState = "loading" | "failed" | "ready";

export interface CloseShiftView {
  staleBanner: boolean;
  body: "no-shift" | "loading" | "preview-failed" | "ready";
  canClose: boolean;
}

export function closeShiftView(input: {
  hasShift: boolean;
  staleShiftId: number | null;
  preview: ClosePreviewState;
}): CloseShiftView {
  const staleBanner = input.staleShiftId != null;
  const body: CloseShiftView["body"] = !input.hasShift
    ? "no-shift"
    : input.preview === "failed"
      ? "preview-failed"
      : input.preview === "loading"
        ? "loading"
        : "ready";
  return { staleBanner, body, canClose: !staleBanner && body === "ready" };
}

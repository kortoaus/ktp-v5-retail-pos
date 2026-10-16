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
// The terminal's shift was never read successfully (boot read failed, or the
// terminal changed and its read failed): no close until a Retry works.
export const SHIFT_LOAD_FAILED_MESSAGE = "Could not load the shift — Retry";

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
  // false while the till has not read this terminal's shift (optional; absent
  // = known).
  shiftKnown?(): boolean;
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
  if (deps.shiftKnown && !deps.shiftKnown())
    return { kind: "stale", message: SHIFT_LOAD_FAILED_MESSAGE };
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
  // The shift could not be loaded for this terminal: "Could not load the
  // shift — Retry" (same Retry as the stale banner).
  unknownBanner: boolean;
  body: "unknown" | "no-shift" | "loading" | "preview-failed" | "ready";
  canClose: boolean;
}

export function closeShiftView(input: {
  hasShift: boolean;
  staleShiftId: number | null;
  preview: ClosePreviewState;
  // Absent = known (callers before round 4).
  shiftKnown?: boolean;
}): CloseShiftView {
  const staleBanner = input.staleShiftId != null;
  const unknownBanner = input.shiftKnown === false && !staleBanner;
  const body: CloseShiftView["body"] = !input.hasShift
    ? unknownBanner
      ? "unknown"
      : "no-shift"
    : input.preview === "failed"
      ? "preview-failed"
      : input.preview === "loading"
        ? "loading"
        : "ready";
  return {
    staleBanner,
    unknownBanner,
    body,
    canClose: !staleBanner && !unknownBanner && body === "ready",
  };
}

// ── Home / Open Shift recovery (T-10 review round 5) ───────────────────────
// Home's Shift row. While the terminal's shift is unknown (its read failed)
// Home must not pretend no shift is open: it offers "Shift status unknown —
// Retry" (the same in-place reload as the Close Shift banner), and Sale /
// Cash In-Out / Close Shift appear once a read succeeds.
export const SHIFT_STATUS_UNKNOWN_MESSAGE = "Shift status unknown — Retry";

export type HomeShiftRow = "unknown" | "open-shift" | "close-shift";

export function homeShiftRow(input: { hasShift: boolean; shiftKnown: boolean }): {
  row: HomeShiftRow;
  // Sale and Cash In / Out need a known open shift.
  showShiftActions: boolean;
} {
  if (!input.shiftKnown) return { row: "unknown", showShiftActions: false };
  return input.hasShift
    ? { row: "close-shift", showShiftActions: true }
    : { row: "open-shift", showShiftActions: false };
}

// The store server answers 400 "Shift already opened" when this terminal has
// an open shift the till did not know about (e.g. its read failed).
export function isShiftAlreadyOpened(res: { ok: boolean; status?: number; msg: string }): boolean {
  return !res.ok && res.status === 400 && /shift already opened/i.test(res.msg);
}

export type OpenShiftOutcome =
  | { kind: "opened" }
  // "already opened": the shift was re-read; reloaded false → still unknown.
  | { kind: "already-open"; reloaded: boolean; message: string }
  | { kind: "failed"; message: string };

export async function openShiftWithRecovery<P>(
  payload: P,
  deps: {
    open(payload: P): Promise<{ ok: boolean; status?: number; msg: string }>;
    // Full reload after a successful open (as before).
    reload(): Promise<boolean>;
    // In-place reload after "already opened".
    reloadInPlace(): Promise<boolean>;
  },
): Promise<OpenShiftOutcome> {
  const res = await deps.open(payload);
  if (res.ok) {
    await deps.reload();
    return { kind: "opened" };
  }
  if (isShiftAlreadyOpened(res)) {
    let reloaded = false;
    try {
      reloaded = await deps.reloadInPlace();
    } catch {
      reloaded = false;
    }
    return {
      kind: "already-open",
      reloaded,
      message: reloaded
        ? "A shift is already open on this terminal — the till has reloaded it."
        : `A shift is already open on this terminal. ${SHIFT_LOAD_FAILED_MESSAGE}.`,
    };
  }
  return { kind: "failed", message: res.msg || "Failed to open shift" };
}

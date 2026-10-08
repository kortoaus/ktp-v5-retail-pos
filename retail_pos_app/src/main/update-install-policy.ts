// T-24 (audit R-10) — when a downloaded till update may install.
//
// The boot update used to call quitAndInstall the moment the download
// finished, even mid-sale. Now main asks the renderer (`update:can-install`)
// whether the till is idle — no cart rows on any open sale, no checkout /
// refund request in flight — and installs at the first idle answer. A busy
// answer, or no answer (renderer not mounted yet, timeout), re-asks every
// 60 s. electron-updater's autoInstallOnAppQuit still installs on a normal
// app quit. Pure: no electron import, so it is unit-tested under node.

export const UPDATE_IDLE_RETRY_MS = 60_000;

// true = idle, false = busy, null = no answer.
export type IdleAnswer = boolean | null;

export interface UpdateInstallGateDeps {
  askIdle(): Promise<IdleAnswer>;
  install(): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  log?(line: string): void;
  retryMs?: number;
}

export interface UpdateInstallGate {
  onUpdateDownloaded(): void;
  isInstalling(): boolean;
  isWaiting(): boolean;
  dispose(): void;
}

export function createUpdateInstallGate(deps: UpdateInstallGateDeps): UpdateInstallGate {
  const retryMs = deps.retryMs ?? UPDATE_IDLE_RETRY_MS;
  const log = deps.log ?? (() => {});
  let downloaded = false;
  let installing = false;
  let disposed = false;
  let timer: unknown = null;

  async function attempt(): Promise<void> {
    timer = null;
    if (installing || disposed) return;
    let idle: IdleAnswer = null;
    try {
      idle = await deps.askIdle();
    } catch {
      idle = null;
    }
    if (installing || disposed) return;
    if (idle === true) {
      installing = true;
      log("[auto-update] till idle — installing");
      deps.install();
      return;
    }
    log(`[auto-update] till ${idle === false ? "busy" : "did not answer"} — asking again in ${Math.round(retryMs / 1000)}s`);
    timer = deps.setTimer(() => {
      void attempt();
    }, retryMs);
  }

  return {
    onUpdateDownloaded() {
      if (downloaded) return;
      downloaded = true;
      void attempt();
    },
    isInstalling: () => installing,
    isWaiting: () => downloaded && !installing && timer != null,
    dispose() {
      disposed = true;
      if (timer != null) deps.clearTimer(timer);
      timer = null;
    },
  };
}

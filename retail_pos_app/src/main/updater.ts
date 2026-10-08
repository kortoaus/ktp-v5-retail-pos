import { app, ipcMain, type BrowserWindow } from "electron";
import electronUpdater, { type AppUpdater } from "electron-updater";
import { createUpdateInstallGate, type IdleAnswer } from "./update-install-policy";

const { autoUpdater } = electronUpdater;

// Renderer answers within this window or the attempt counts as "busy".
const IDLE_ANSWER_TIMEOUT_MS = 5_000;

function getAutoUpdater(): AppUpdater {
  return autoUpdater;
}

let nextRequestId = 0;
const pendingAnswers = new Map<number, (idle: IdleAnswer) => void>();

// IPC round trip: main → renderer `update:can-install` (requestId), renderer →
// main `update:can-install:reply` (requestId, idle). See preload
// onUpdateCanInstall and renderer components/UpdateReadyHint.tsx.
function askRendererIdle(getWindow: () => BrowserWindow | null): Promise<IdleAnswer> {
  const win = getWindow();
  if (!win || win.isDestroyed()) return Promise.resolve(null);
  const id = ++nextRequestId;
  return new Promise<IdleAnswer>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAnswers.delete(id);
      resolve(null);
    }, IDLE_ANSWER_TIMEOUT_MS);
    pendingAnswers.set(id, (idle) => {
      clearTimeout(timeout);
      pendingAnswers.delete(id);
      resolve(idle);
    });
    win.webContents.send("update:can-install", id);
  });
}

export function checkForBootUpdate(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return;

  const updater = getAutoUpdater();
  updater.autoDownload = true;
  // Still installs on a normal quit even if the till never became idle.
  updater.autoInstallOnAppQuit = true;

  ipcMain.on("update:can-install:reply", (_event, id: unknown, idle: unknown) => {
    if (typeof id !== "number") return;
    pendingAnswers.get(id)?.(idle === true);
  });

  // T-24 (R-10) — install only when the renderer says the till is idle.
  const gate = createUpdateInstallGate({
    askIdle: () => askRendererIdle(getWindow),
    install: () => {
      setImmediate(() => {
        updater.quitAndInstall(false, true);
      });
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    log: (line) => console.log(line),
  });

  app.once("before-quit", () => gate.dispose());

  updater.on("error", (error) => {
    console.error("[auto-update] failed", error);
  });

  updater.once("update-downloaded", () => {
    gate.onUpdateDownloaded();
  });

  updater.checkForUpdates().catch((error) => {
    console.error("[auto-update] check failed", error);
  });
}

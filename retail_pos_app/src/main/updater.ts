import { app } from "electron";
import electronUpdater, { type AppUpdater } from "electron-updater";

const { autoUpdater } = electronUpdater;

function getAutoUpdater(): AppUpdater {
  return autoUpdater;
}

export function checkForBootUpdate(): void {
  if (!app.isPackaged) return;

  const updater = getAutoUpdater();
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  updater.on("error", (error) => {
    console.error("[auto-update] failed", error);
  });

  updater.once("update-downloaded", () => {
    setImmediate(() => {
      updater.quitAndInstall(false, true);
    });
  });

  updater.checkForUpdates().catch((error) => {
    console.error("[auto-update] check failed", error);
  });
}

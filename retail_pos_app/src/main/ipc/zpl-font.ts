/**
 * The only adapter between the app and the ZPL font library.
 *
 * Everything electron-shaped lives here — resolving the packaged font
 * directory, IPC channels, forwarding progress to the renderer — so that
 * `zpl-font/` stays a plain node library that the coming label rewrite can
 * leave alone.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { app, ipcMain, type WebContents } from "electron";
import {
  createZplFontService,
  type FontStatus,
  type InstallProgress,
  type InstallResult,
  type PrinterTarget,
  type ZplFontService,
} from "../zpl-font";

export const ZPL_FONT_CHANNELS = {
  status: "zpl-font:status",
  install: "zpl-font:install",
  testPrint: "zpl-font:test-print",
  progress: "zpl-font:progress",
} as const;

export interface ZplFontInstallRequest {
  target: PrinterTarget;
  force?: boolean;
  weights?: string[];
}

export interface ZplFontTestPrintRequest {
  target: PrinterTarget;
  widthMm?: number;
  heightMm?: number;
  dpi?: number;
}

export type ZplFontResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** Payload of the `zpl-font:progress` push, tagged so a renderer with several
 *  printers on screen can tell which row a tick belongs to. */
export interface ZplFontProgressEvent {
  target: PrinterTarget;
  progress: InstallProgress;
}

/**
 * Find the bundled fonts in both dev and a packaged build.
 *
 * `resources/**` is listed in build.files and asarUnpack, so packaged it lands
 * beside the asar rather than inside it. Candidates are probed rather than
 * branched on `app.isPackaged` because getting this wrong surfaces as a missing
 * font at the till, not at build time.
 */
function resolveFontDir(): string {
  const candidates = [
    path.join(process.resourcesPath ?? "", "app.asar.unpacked", "resources", "fonts"),
    path.join(app.getAppPath(), "resources", "fonts"),
    path.join(process.resourcesPath ?? "", "resources", "fonts"),
  ];
  const found = candidates.find((dir) => dir && existsSync(dir));
  if (!found) {
    throw new Error(`bundled fonts not found; looked in:\n  ${candidates.join("\n  ")}`);
  }
  return found;
}

let service: ZplFontService | null = null;

function getService(): ZplFontService {
  if (!service) service = createZplFontService({ fontDir: resolveFontDir() });
  return service;
}

/**
 * Whether a font transfer is running to this printer.
 *
 * A ~DY in flight consumes everything arriving on the port until its byte count
 * is satisfied, so a label printed to the same printer mid-install is eaten by
 * the font and lost. Nothing gates on this yet — it is here for the label
 * pipeline to use when it is rewritten.
 */
export function isZplFontTransferRunning(target: PrinterTarget): boolean {
  return service?.isBusy(target) ?? false;
}

function fail(err: unknown): { ok: false; message: string } {
  return { ok: false, message: err instanceof Error ? err.message : "Unknown error" };
}

export function registerZplFontHandlers(): void {
  ipcMain.handle(
    ZPL_FONT_CHANNELS.status,
    async (_event, target: PrinterTarget): Promise<ZplFontResult<FontStatus>> => {
      try {
        return { ok: true, data: await getService().status(target) };
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    ZPL_FONT_CHANNELS.install,
    async (event, request: ZplFontInstallRequest): Promise<ZplFontResult<InstallResult>> => {
      const sender: WebContents = event.sender;
      try {
        const data = await getService().install(request.target, {
          force: request.force,
          weights: request.weights,
          onProgress: (progress: InstallProgress) => {
            if (sender.isDestroyed()) return;
            sender.send(ZPL_FONT_CHANNELS.progress, { target: request.target, progress });
          },
        });
        return { ok: true, data };
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle(
    ZPL_FONT_CHANNELS.testPrint,
    async (_event, request: ZplFontTestPrintRequest): Promise<ZplFontResult<null>> => {
      try {
        await getService().testPrint(request.target, {
          widthMm: request.widthMm,
          heightMm: request.heightMm,
          dpi: request.dpi,
        });
        return { ok: true, data: null };
      } catch (err) {
        return fail(err);
      }
    },
  );
}

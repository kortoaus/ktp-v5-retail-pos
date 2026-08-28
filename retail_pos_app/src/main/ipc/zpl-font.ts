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
import { SerialPort } from "serialport";
import {
  createZplFontService,
  normalizeTarget,
  SERIAL_OPEN_TIMEOUT_MS,
  type FontStatus,
  type InstallProgress,
  type InstallResult,
  type PrinterTarget,
  type PrinterTargetInput,
  type SerialPortLike,
  type ZplFontService,
} from "../zpl-font";
import {
  createSerialPortHolder,
  serialPortLock,
  type SerialPortHolder,
} from "../serial-port-lock";

export const ZPL_FONT_CHANNELS = {
  status: "zpl-font:status",
  install: "zpl-font:install",
  testPrint: "zpl-font:test-print",
  progress: "zpl-font:progress",
} as const;

export interface ZplFontInstallRequest {
  target: PrinterTargetInput;
  force?: boolean;
  weights?: string[];
  /**
   * Resolution and media for the proof label a blind install prints. A printer
   * that answers ~HI reports its own resolution and ignores the dpi.
   */
  dpi?: number;
  widthMm?: number;
  heightMm?: number;
}

export interface ZplFontTestPrintRequest {
  target: PrinterTargetInput;
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

/**
 * The one holder the font subsystem claims serial ports under.
 *
 * Module-level rather than per-operation, and that is deliberate: the service's
 * own busy set already refuses a second font operation on the same printer, so
 * the only thing this identity has to do is be *different* from the label
 * pipeline's. Sharing it makes the lease reentrant for free — an install holds
 * the path for its whole ten-minute run and re-takes it once per font as each
 * connection opens.
 */
const FONT_HOLDER: SerialPortHolder = createSerialPortHolder("a Korean font install");

/**
 * Open a serial label printer the way `ipc/label.ts` does, and hold the port.
 *
 * Same wire settings as a print job — 115200/8/N/1, XON/XOFF, DTR and RTS
 * asserted — because it is the same printer expecting the same framing; a font
 * install that negotiated differently would work on the bench and fail on the
 * one terminal whose cable is wired for hardware handshaking.
 *
 * The lease is released on close or destroy, whichever happens, and only once.
 */
function openFontSerialPort(portPath: string): Promise<SerialPortLike> {
  const release = serialPortLock.acquire(portPath, FONT_HOLDER);

  return new Promise<SerialPortLike>((resolve, reject) => {
    const port = new SerialPort({
      path: portPath,
      baudRate: 115200,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      xon: true,
      xoff: true,
      rtscts: false,
      autoOpen: false,
    });

    let releaseOnce = (): void => {
      releaseOnce = () => {};
      release();
    };

    const openTimer = setTimeout(() => {
      releaseOnce();
      try {
        port.destroy();
      } catch {
        /* the driver is already wedged; nothing left to do about it */
      }
      reject(new Error(`serial port ${portPath} did not open within ${SERIAL_OPEN_TIMEOUT_MS}ms`));
    }, SERIAL_OPEN_TIMEOUT_MS);

    port.open((err) => {
      clearTimeout(openTimer);
      if (err) {
        releaseOnce();
        reject(new Error(`cannot open ${portPath}: ${err.message}`, { cause: err }));
        return;
      }

      // Best effort, exactly as in ipc/label.ts: some USB bridges reject this
      // and print perfectly well anyway.
      port.set({ dtr: true, rts: true }, (setErr) => {
        if (setErr) console.log(`[ZplFont:Serial] Set DTR/RTS skipped: ${setErr.message}`);
      });

      resolve(adaptSerialPort(port, portPath, releaseOnce));
    });
  });
}

/**
 * Wrap a serialport instance in the narrow, callback-shaped surface the library
 * asks for.
 *
 * Written out rather than passed through so the library keeps no dependency on
 * serialport's EventEmitter typings — and so `close()` cannot forget to release
 * the lease.
 */
function adaptSerialPort(port: SerialPort, portPath: string, release: () => void): SerialPortLike {
  const on = <T>(event: string, listener: (arg: T) => void): (() => void) => {
    const wrapped = (arg: T): void => listener(arg);
    port.on(event, wrapped);
    return () => {
      port.off(event, wrapped);
    };
  };

  return {
    path: portPath,
    write: (data, callback) => port.write(Buffer.from(data), callback),
    drain: (callback) => port.drain(callback),
    close: () =>
      new Promise<void>((resolve, reject) => {
        // Drain before close, or the tail of the last chunk is discarded with
        // the port — the same order ipc/label.ts uses for a label.
        port.drain(() => {
          port.close((closeErr) => {
            release();
            if (closeErr) reject(closeErr);
            else resolve();
          });
        });
      }),
    destroy: () => {
      try {
        port.destroy();
      } catch {
        /* already gone */
      }
      release();
    },
    onData: (listener) => on<Buffer>("data", (chunk) => listener(chunk)),
    onError: (listener) => on<Error>("error", listener),
    onClose: (listener) => on<void>("close", () => listener()),
  };
}

let service: ZplFontService | null = null;

function getService(): ZplFontService {
  if (!service) {
    service = createZplFontService({
      fontDir: resolveFontDir(),
      serial: { open: openFontSerialPort },
    });
  }
  return service;
}

/**
 * Hold a serial target's port for the whole operation, not just per connection.
 *
 * Each font opens and closes its own connection, and between two of them the
 * port is momentarily free. Without this outer lease a label job could slip
 * into that gap: harmless for the fonts, but it turns "the port is busy for the
 * next ten minutes" into an intermittent race, which is worse to diagnose than
 * a flat refusal. A net target takes this path unchanged and locks nothing.
 */
async function withTargetHeld<T>(target: PrinterTarget, fn: () => Promise<T>): Promise<T> {
  if (target.type !== "serial") return fn();
  const release = serialPortLock.acquire(target.path, FONT_HOLDER);
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Whether a font transfer is running to this printer.
 *
 * A ~DY in flight consumes everything arriving on the port until its byte count
 * is satisfied, so a label printed to the same printer mid-install is eaten by
 * the font and lost.
 *
 * For **serial** targets the real guard is `main/serial-port-lock.ts`, which
 * `ipc/label.ts` checks before it opens a port — that one is enforced, because
 * a physical port genuinely cannot be shared. This remains the advisory answer
 * for **net** targets, where nothing gates yet; the label pipeline can use it
 * when it is rewritten.
 */
export function isZplFontTransferRunning(target: PrinterTargetInput): boolean {
  return service?.isBusy(target) ?? false;
}

function fail(err: unknown): { ok: false; message: string } {
  return { ok: false, message: err instanceof Error ? err.message : "Unknown error" };
}

export function registerZplFontHandlers(): void {
  ipcMain.handle(
    ZPL_FONT_CHANNELS.status,
    async (
      _event,
      targetInput: PrinterTargetInput,
      dpi?: number,
    ): Promise<ZplFontResult<FontStatus>> => {
      try {
        const target = normalizeTarget(targetInput);
        return {
          ok: true,
          data: await withTargetHeld(target, () => getService().status(target, { dpi })),
        };
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
        const target = normalizeTarget(request.target);
        const data = await withTargetHeld(target, () =>
          getService().install(target, {
            force: request.force,
            weights: request.weights,
            dpi: request.dpi,
            widthMm: request.widthMm,
            heightMm: request.heightMm,
            onProgress: (progress: InstallProgress) => {
              if (sender.isDestroyed()) return;
              // The normalized target, not what the renderer sent: the panel
              // matches ticks to its own row by these fields.
              sender.send(ZPL_FONT_CHANNELS.progress, { target, progress });
            },
          }),
        );
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
        const target = normalizeTarget(request.target);
        await withTargetHeld(target, () =>
          getService().testPrint(target, {
            widthMm: request.widthMm,
            heightMm: request.heightMm,
            dpi: request.dpi,
          }),
        );
        return { ok: true, data: null };
      } catch (err) {
        return fail(err);
      }
    },
  );
}

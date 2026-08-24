/**
 * The library's one public surface: status, install, proof print.
 */

import { createReadStream } from "node:fs";
import {
  downloadObjectHeader,
  hostDirectory,
  hostIdentification,
  parseDirectoryListing,
  parsePrinterIdentity,
  proofLabel,
  type DirectoryListing,
} from "./commands";
import { loadFonts, selectFonts, type BundledFont } from "./catalog";
import { query, send, withConnection, type ConnectOptions } from "./transport";
import {
  PrinterBusyError,
  type FontStatus,
  type FontStatusEntry,
  type InstallOptions,
  type InstallResult,
  type PrinterTarget,
  type TestPrintOptions,
} from "./types";

const CHUNK_SIZE = 64 * 1024;
const DEFAULT_DPMM = 8; // 203 dpi, the common ZD421

export interface ZplFontServiceOptions {
  /** Directory holding the bundled .ttf files. */
  fontDir: string;
  connect?: Omit<ConnectOptions, "host" | "port">;
  /**
   * How long to wait for a query reply that never starts arriving.
   *
   * Replies end on a quiet period rather than EOF, so this only bites when the
   * printer answers nothing at all — a socket that accepts but does not talk.
   * It is the whole cost of `status()` against such a printer, which is a
   * spinner someone is watching, so it stays short.
   */
  queryTimeoutMs?: number;
}

export interface ZplFontService {
  status(target: PrinterTarget): Promise<FontStatus>;
  install(target: PrinterTarget, opts?: InstallOptions): Promise<InstallResult>;
  testPrint(target: PrinterTarget, opts?: TestPrintOptions): Promise<void>;
  /**
   * Whether a transfer to this printer is in flight.
   *
   * Exposed because a ~DY in progress swallows everything arriving on the port
   * until its byte count is satisfied — so anything else printing to the same
   * printer during an install corrupts the font and loses the label. Nothing
   * consumes this yet; the label pipeline can gate on it when it is rewritten.
   */
  isBusy(target: PrinterTarget): boolean;
}

export function createZplFontService(opts: ZplFontServiceOptions): ZplFontService {
  const { fontDir } = opts;
  const queryTimeoutMs = opts.queryTimeoutMs ?? 8_000;
  const busy = new Set<string>();

  const connectOpts = (target: PrinterTarget): ConnectOptions => ({
    ...opts.connect,
    host: target.host,
    port: target.port,
  });

  const key = (target: PrinterTarget) => `${target.host}:${target.port}`;

  async function readListing(target: PrinterTarget): Promise<DirectoryListing> {
    const raw = await query(connectOpts(target), hostDirectory("E:*.*"), {
      idleMs: 500,
      maxMs: queryTimeoutMs,
    });
    return parseDirectoryListing(raw);
  }

  async function readIdentity(target: PrinterTarget) {
    const raw = await query(connectOpts(target), hostIdentification(), {
      idleMs: 300,
      maxMs: queryTimeoutMs,
    });
    return parsePrinterIdentity(raw);
  }

  function describe(bundled: BundledFont[], listing: DirectoryListing): FontStatusEntry[] {
    const onPrinter = new Map(listing.entries.map((e) => [e.filename, e.size]));
    return bundled.map((font) => {
      const installedSize = onPrinter.get(font.filename) ?? null;
      return {
        weight: font.weight,
        sourceFile: font.sourceFile,
        objectName: font.objectName,
        filename: font.filename,
        bundledSize: font.size,
        installedSize,
        state:
          installedSize === null ? "missing" : installedSize === font.size ? "installed" : "mismatch",
      };
    });
  }

  async function status(target: PrinterTarget): Promise<FontStatus> {
    const bundled = await loadFonts(fontDir);
    const identity = await readIdentity(target).catch(() => null);
    const listing = await readListing(target);
    const fonts = describe(bundled, listing);

    return {
      identity,
      fonts,
      installedCount: fonts.filter((f) => f.state === "installed").length,
      totalCount: fonts.length,
      freeBytes: listing.freeBytes,
    };
  }

  /**
   * Stream one font into flash with ~DY.
   *
   * Header and payload share a connection, which the ~DY documentation requires:
   * the printer counts bytes until the declared total arrives, and the socket
   * has to stay up for all of them. Each font gets its own connection so a
   * failure part-way leaves the printer waiting on that socket alone rather than
   * poisoning the rest of the batch.
   */
  async function pushFont(
    target: PrinterTarget,
    font: BundledFont,
    onChunk?: (sent: number) => void,
  ): Promise<void> {
    await withConnection(connectOpts(target), async (conn) => {
      await conn.write(downloadObjectHeader("E:", font.objectName, font.size));

      let sent = 0;
      const stream = createReadStream(font.filePath, { highWaterMark: CHUNK_SIZE });
      for await (const chunk of stream) {
        await conn.write(chunk as Uint8Array);
        sent += (chunk as Uint8Array).length;
        onChunk?.(sent);
      }

      if (sent !== font.size) {
        throw new Error(
          `${font.sourceFile}: sent ${sent} bytes but declared ${font.size}; ` +
            `the printer is still waiting for ${font.size - sent} more`,
        );
      }

      await conn.settle();
    });
  }

  async function install(
    target: PrinterTarget,
    installOpts: InstallOptions = {},
  ): Promise<InstallResult> {
    const id = key(target);
    if (busy.has(id)) throw new PrinterBusyError(target);
    busy.add(id);

    const started = Date.now();
    try {
      const specs = selectFonts(installOpts.weights);
      const bundled = await loadFonts(fontDir, specs);
      const listing = await readListing(target);
      const onPrinter = new Map(listing.entries.map((e) => [e.filename, e.size]));

      const pending: BundledFont[] = [];
      const skipped: BundledFont[] = [];
      for (const font of bundled) {
        if (!installOpts.force && onPrinter.get(font.filename) === font.size) skipped.push(font);
        else pending.push(font);
      }

      for (const [i, font] of pending.entries()) {
        await pushFont(target, font, (sentBytes) =>
          installOpts.onProgress?.({
            index: i + 1,
            count: pending.length,
            weight: font.weight,
            filename: font.filename,
            sentBytes,
            totalBytes: font.size,
          }),
        );
      }

      // Re-read rather than trust the transfer: the printer is the only thing
      // that can say an object landed at its declared size.
      const after = await status(target);
      const bad = after.fonts.filter(
        (f) => pending.some((p) => p.filename === f.filename) && f.state !== "installed",
      );
      if (bad.length) {
        throw new Error(
          `install did not verify: ${bad
            .map((f) => `${f.filename} is ${f.installedSize ?? "absent"}, expected ${f.bundledSize}`)
            .join("; ")}`,
        );
      }

      return {
        sent: pending.map(toSpec),
        skipped: skipped.map(toSpec),
        elapsedMs: Date.now() - started,
        status: after,
      };
    } finally {
      busy.delete(id);
    }
  }

  async function testPrint(target: PrinterTarget, printOpts: TestPrintOptions = {}): Promise<void> {
    const id = key(target);
    if (busy.has(id)) throw new PrinterBusyError(target);

    const current = await status(target);
    const wanted = selectFonts(printOpts.weights);
    const printable = current.fonts.filter(
      (f) => f.state === "installed" && wanted.some((w) => w.filename === f.filename),
    );
    if (!printable.length) {
      throw new Error("no installed font to print with — install first");
    }

    const dpmm = printOpts.dpi
      ? nearestDpmm(printOpts.dpi / 25.4)
      : (current.identity?.dpmm ?? DEFAULT_DPMM);

    const zpl = proofLabel({
      dpmm,
      widthMm: printOpts.widthMm ?? 100,
      heightMm: printOpts.heightMm,
      fonts: printable.map((f) => ({ filename: f.filename, weight: f.weight })),
    });

    await send(connectOpts(target), Buffer.from(zpl, "utf8"));
  }

  return {
    status,
    install,
    testPrint,
    isBusy: (target) => busy.has(key(target)),
  };
}

function toSpec(font: BundledFont) {
  return {
    weight: font.weight,
    sourceFile: font.sourceFile,
    objectName: font.objectName,
    filename: font.filename,
  };
}

function nearestDpmm(dpmm: number): number {
  return [6, 8, 12, 24].reduce((a, b) => (Math.abs(b - dpmm) < Math.abs(a - dpmm) ? b : a));
}

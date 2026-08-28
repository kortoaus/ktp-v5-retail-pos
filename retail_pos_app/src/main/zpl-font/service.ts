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
  PROOF_BUILTIN_REFERENCE,
  PROOF_VERDICT,
  type DirectoryListing,
} from "./commands";
import { loadFonts, selectFonts, type BundledFont } from "./catalog";
import { query, send, withLink, type LinkOptions } from "./link";
import { SERIAL_QUERY_TIMEOUT_MS, type SerialLinkOptions } from "./serial-transport";
import type { ConnectOptions } from "./transport";
import { normalizeTarget, targetKey, type PrinterTargetInput } from "./target";
import {
  PrinterBusyError,
  type FontState,
  type FontStatus,
  type FontStatusEntry,
  type InstallOptions,
  type InstallResult,
  type PrinterCapabilities,
  type PrinterIdentity,
  type PrinterTarget,
  type StatusOptions,
  type TestPrintOptions,
} from "./types";

/**
 * Default read size off disk.
 *
 * TCP is happy with 64 KiB. A serial link overrides it downward through
 * `link.chunkSize` — see `serial-transport.ts` for why 4 KiB there.
 */
const CHUNK_SIZE = 64 * 1024;
const DEFAULT_DPMM = 8; // 203 dpi — the common ZD421, and every Bixolon XD3/XD5 seen so far

/** What a blind status says, and what the panel repeats to the user. */
const BLIND_STATUS_MESSAGE =
  "This printer answers no status query, so what it holds cannot be read. " +
  "Install and confirm from the proof label.";

const BLIND_INSTALL_MESSAGE =
  "Sent, but this printer reports nothing back — check the proof label that just printed: " +
  "if the Korean sample rendered, the install is good.";

export interface ZplFontServiceOptions {
  /** Directory holding the bundled .ttf files. */
  fontDir: string;
  connect?: Omit<ConnectOptions, "host" | "port">;
  /**
   * Serial support, including the port opener.
   *
   * Omitted, serial targets are refused with a message saying so — this
   * directory imports no native module, so the host app supplies `serialport`.
   */
  serial?: SerialLinkOptions;
  /**
   * Reply timeout for a serial target.
   *
   * Longer than the network one and for a different reason: a label printer is
   * often wired TX-only, so "no reply" is the expected answer rather than a
   * fault, and this is the whole cost of finding that out. It is paid once per
   * status check, not per font.
   */
  serialQueryTimeoutMs?: number;
  /**
   * How long to wait for a query reply that never starts arriving.
   *
   * Replies end on a quiet period rather than EOF, so this only bites when the
   * printer answers nothing at all — a socket that accepts but does not talk.
   * It is the whole cost of `status()` against such a printer, which is a
   * spinner someone is watching, so it stays short.
   *
   * A Bixolon in BPL-Z hits it on every call by design, which is why blind
   * mode asks ~HI and stops rather than going on to ^HW: one timeout, not two.
   */
  queryTimeoutMs?: number;
}

export interface ZplFontService {
  status(target: PrinterTargetInput, opts?: StatusOptions): Promise<FontStatus>;
  install(target: PrinterTargetInput, opts?: InstallOptions): Promise<InstallResult>;
  testPrint(target: PrinterTargetInput, opts?: TestPrintOptions): Promise<void>;
  /**
   * Whether a transfer to this printer is in flight.
   *
   * Exposed because a ~DY in progress swallows everything arriving on the port
   * until its byte count is satisfied — so anything else printing to the same
   * printer during an install corrupts the font and loses the label. Nothing
   * consumes this yet; the label pipeline can gate on it when it is rewritten.
   */
  isBusy(target: PrinterTargetInput): boolean;
}

export function createZplFontService(opts: ZplFontServiceOptions): ZplFontService {
  const { fontDir } = opts;
  const queryTimeoutMs = opts.queryTimeoutMs ?? 8_000;
  const busy = new Set<string>();

  const serialQueryTimeoutMs = opts.serialQueryTimeoutMs ?? SERIAL_QUERY_TIMEOUT_MS;

  const linkOpts = (payloadBytes?: number): LinkOptions => ({
    net: opts.connect,
    serial: opts.serial,
    payloadBytes,
  });

  /**
   * How long to wait for a reply, and how long a gap ends one.
   *
   * Serial gets both numbers roughly doubled. At 115200 baud the reply itself
   * takes measurably longer to arrive, and a printer wired without a return
   * line never answers at all — being impatient there would misclassify a
   * talkative printer as a mute one and skip the ^HW verification for nothing.
   */
  const replyTiming = (target: PrinterTarget, netIdleMs: number) =>
    target.type === "serial"
      ? { idleMs: netIdleMs * 2, maxMs: serialQueryTimeoutMs }
      : { idleMs: netIdleMs, maxMs: queryTimeoutMs };

  async function readListing(target: PrinterTarget): Promise<DirectoryListing> {
    const raw = await query(
      target,
      linkOpts(),
      hostDirectory("E:*.*"),
      replyTiming(target, 500),
    );
    return parseDirectoryListing(raw);
  }

  /**
   * Ask who the printer is, and — the point of this — whether it answers at all.
   *
   * A Bixolon XD3/XD5 in BPL-Z accepts the connection, accepts ~HI, and sends
   * back nothing, ever. That is not a broken printer and not a timeout worth
   * reporting: it is a printer that will take the fonts and print hangul but
   * will never confirm either. Silence is therefore classified, not thrown, so
   * install and testPrint can switch to working blind.
   *
   * Over serial there is a second, more ordinary way to be mute: plenty of
   * label printers are cabled TX-only, so the reply has nowhere to go. It is
   * the same answer either way — work blind — which is why serial gets the
   * identical treatment rather than a special case.
   *
   * Failures to *reach* the printer still propagate — an unplugged printer and
   * a mute one must not look the same.
   */
  async function probe(
    target: PrinterTarget,
  ): Promise<{ responds: boolean; identity: PrinterIdentity | null }> {
    const raw = await query(target, linkOpts(), hostIdentification(), replyTiming(target, 300));
    // Nothing at all within both timeouts, versus bytes we could not parse:
    // the first is blind mode, the second is a Zebra with an odd ~HI reply.
    if (!raw.trim()) return { responds: false, identity: null };
    return { responds: true, identity: parsePrinterIdentity(raw) };
  }

  function capabilitiesOf(
    responds: boolean,
    identity: PrinterIdentity | null,
    dpiOverride?: number,
  ): PrinterCapabilities {
    const caps: PrinterCapabilities = { responds };
    if (identity?.model) caps.model = identity.model;
    const dpi = identity?.dpi ?? dpiOverride;
    if (dpi) caps.dpi = dpi;
    return caps;
  }

  /**
   * The status of a printer that will not talk: bundled fonts, no findings.
   *
   * `state` carries the whole distinction — `unknown` before an install (we
   * have never sent these bytes), `unverified` after one (we sent them and the
   * printer took them, but only the proof label can say they landed).
   */
  function blindStatus(
    bundled: BundledFont[],
    state: Extract<FontState, "unknown" | "unverified">,
    dpiOverride: number | undefined,
    message: string,
  ): FontStatus {
    return {
      identity: null,
      capabilities: capabilitiesOf(false, null, dpiOverride),
      fonts: bundled.map((font) => ({
        weight: font.weight,
        sourceFile: font.sourceFile,
        objectName: font.objectName,
        filename: font.filename,
        bundledSize: font.size,
        installedSize: null,
        state,
      })),
      // Not counted as installed either way: nothing has confirmed anything.
      installedCount: 0,
      totalCount: bundled.length,
      freeBytes: null,
      message,
    };
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

  async function status(
    targetInput: PrinterTargetInput,
    statusOpts: StatusOptions = {},
  ): Promise<FontStatus> {
    const target = normalizeTarget(targetInput);
    const bundled = await loadFonts(fontDir);
    const { responds, identity } = await probe(target);

    // ^HW would be a second silent timeout on a printer that just proved it
    // does not answer queries, so it is not even asked.
    if (!responds) {
      return blindStatus(bundled, "unknown", statusOpts.dpi, BLIND_STATUS_MESSAGE);
    }

    const listing = await readListing(target);
    const fonts = describe(bundled, listing);

    return {
      identity,
      capabilities: capabilitiesOf(true, identity, statusOpts.dpi),
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
   *
   * The read size comes from the link. TCP takes 64 KiB happily; serial asks
   * for 4 KiB, which is also what makes the progress ticks over a four-minute
   * serial transfer frequent enough for a person to trust that it is moving.
   */
  async function pushFont(
    target: PrinterTarget,
    font: BundledFont,
    onChunk?: (sent: number) => void,
  ): Promise<void> {
    await withLink(target, linkOpts(font.size), async (conn) => {
      await conn.write(downloadObjectHeader("E:", font.objectName, font.size));

      let sent = 0;
      const stream = createReadStream(font.filePath, {
        highWaterMark: conn.chunkSize ?? CHUNK_SIZE,
      });
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

  /** Stream a batch of fonts in order, reporting progress across the batch. */
  async function streamAll(
    target: PrinterTarget,
    pending: BundledFont[],
    onProgress: InstallOptions["onProgress"],
  ): Promise<void> {
    for (const [i, font] of pending.entries()) {
      await pushFont(target, font, (sentBytes) =>
        onProgress?.({
          index: i + 1,
          count: pending.length,
          weight: font.weight,
          filename: font.filename,
          sentBytes,
          totalBytes: font.size,
        }),
      );
    }
  }

  function resolveDpmm(dpi: number | undefined, identity: PrinterIdentity | null): number {
    if (dpi) return nearestDpmm(dpi / 25.4);
    return identity?.dpmm ?? DEFAULT_DPMM;
  }

  /**
   * Print the label that shows whether the fonts render.
   *
   * `blind` adds the two ^A0 footer lines. On a printer that reports nothing
   * this label is the entire verification step, so it has to explain itself to
   * whoever picks it up rather than assume they know what they are looking at.
   */
  async function sendProof(
    target: PrinterTarget,
    fonts: { filename: string; weight: string }[],
    opts: { dpmm: number; widthMm?: number; heightMm?: number; blind: boolean },
  ): Promise<void> {
    const zpl = proofLabel({
      dpmm: opts.dpmm,
      widthMm: opts.widthMm ?? 100,
      heightMm: opts.heightMm,
      fonts,
      footer: opts.blind ? [PROOF_BUILTIN_REFERENCE, PROOF_VERDICT] : undefined,
    });
    await send(target, linkOpts(), Buffer.from(zpl, "utf8"));
  }

  async function install(
    targetInput: PrinterTargetInput,
    installOpts: InstallOptions = {},
  ): Promise<InstallResult> {
    const target = normalizeTarget(targetInput);
    const id = targetKey(target);
    if (busy.has(id)) throw new PrinterBusyError(target);
    busy.add(id);

    const started = Date.now();
    try {
      const specs = selectFonts(installOpts.weights);
      const bundled = await loadFonts(fontDir, specs);
      const { responds, identity } = await probe(target);

      // Blind install. No ^HW beforehand to decide what to skip and none after
      // to verify, because this printer answers neither — every requested
      // weight is sent, and the proof label goes out in the same breath so the
      // user is never left holding an unverifiable "done".
      //
      // Still inside the busy set: that proof print shares the port with the
      // ~DY stream that just finished, and it must not race a label from
      // anywhere else.
      if (!responds) {
        await streamAll(target, bundled, installOpts.onProgress);
        await sendProof(target, bundled, {
          dpmm: resolveDpmm(installOpts.dpi, null),
          widthMm: installOpts.widthMm,
          heightMm: installOpts.heightMm,
          blind: true,
        });

        return {
          sent: bundled.map(toSpec),
          skipped: [],
          elapsedMs: Date.now() - started,
          status: blindStatus(bundled, "unverified", installOpts.dpi, BLIND_INSTALL_MESSAGE),
          verified: false,
          message: BLIND_INSTALL_MESSAGE,
        };
      }

      const listing = await readListing(target);
      const onPrinter = new Map(listing.entries.map((e) => [e.filename, e.size]));

      const pending: BundledFont[] = [];
      const skipped: BundledFont[] = [];
      for (const font of bundled) {
        if (!installOpts.force && onPrinter.get(font.filename) === font.size) skipped.push(font);
        else pending.push(font);
      }

      await streamAll(target, pending, installOpts.onProgress);

      // Re-read rather than trust the transfer: the printer is the only thing
      // that can say an object landed at its declared size.
      const after = await status(target, { dpi: installOpts.dpi });
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
        verified: true,
      };
    } finally {
      busy.delete(id);
    }
  }

  async function testPrint(
    targetInput: PrinterTargetInput,
    printOpts: TestPrintOptions = {},
  ): Promise<void> {
    const target = normalizeTarget(targetInput);
    const id = targetKey(target);
    if (busy.has(id)) throw new PrinterBusyError(target);

    const current = await status(target, { dpi: printOpts.dpi });
    const wanted = selectFonts(printOpts.weights);
    const blind = !current.capabilities.responds;

    // On a printer that reports nothing, "is it installed" is exactly the
    // question the label exists to answer — refusing to print until something
    // says it is installed would mean never printing at all. So any bundled
    // weight may be attempted, and a blank row is the answer.
    const printable = blind
      ? wanted.map((w) => ({ filename: w.filename, weight: w.weight }))
      : current.fonts.filter(
          (f) => f.state === "installed" && wanted.some((w) => w.filename === f.filename),
        );

    if (!printable.length) {
      throw new Error("no installed font to print with — install first");
    }

    await sendProof(target, printable, {
      dpmm: resolveDpmm(printOpts.dpi, current.identity),
      widthMm: printOpts.widthMm,
      heightMm: printOpts.heightMm,
      blind,
    });
  }

  return {
    status,
    install,
    testPrint,
    isBusy: (target) => busy.has(targetKey(normalizeTarget(target))),
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

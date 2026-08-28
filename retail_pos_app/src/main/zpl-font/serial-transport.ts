/**
 * Serial transport for ZPL printers.
 *
 * The network side of this library streams a 2.5MB font in about four seconds.
 * The serial side, at the 115200/8/N/1 every label printer in this fleet is
 * wired for, moves about 11.5 KB/s — the same font takes roughly **three and a
 * half minutes**, and all three take a little over ten. Nothing about that is
 * unusual for the wire; what it changes is the failure model. A four-minute
 * write that stalls silently is indistinguishable from a working one until a
 * human power-cycles the printer, so this layer is deliberately timid:
 *
 * - small chunks (4 KiB), each one gated on `drain()` so the next byte is
 *   written only after the OS says the previous ones left the buffer. With
 *   XON/XOFF on, that also means the printer's own flow control is respected —
 *   a printer asserting XOFF simply makes the drain take longer;
 * - a generous per-chunk timeout (30s) — long enough for a printer pausing to
 *   commit a flash page, short enough that a dead one fails inside a minute;
 * - an overall deadline scaled to the payload, so a printer that accepts every
 *   chunk *just* under the per-chunk timeout still cannot run forever;
 * - the port is destroyed, not merely closed, on timeout: a half-written ~DY
 *   leaves the printer counting bytes, and a clean close would let a later job
 *   feed the rest of its label into that count.
 *
 * The SerialPort itself is injected. This directory imports no app module and
 * no native dependency, so the library still runs under plain `node --test`
 * with a fake port; `ipc/zpl-font.ts` supplies the real one.
 */

import type { CollectOptions, PrinterLink } from "./transport";

// ---------------------------------------------------------------------------
// Sizing — pure, and tested as such
// ---------------------------------------------------------------------------

/**
 * Bytes per write.
 *
 * Small on purpose. The chunk is the unit of progress reporting and the unit a
 * stall is detected in, and at 11.5 KB/s a 4 KiB chunk is about a third of a
 * second — fine-grained enough that the percentage on screen moves visibly, and
 * small enough that a stalled transfer has at most 4 KiB in flight to abandon.
 */
export const SERIAL_CHUNK_SIZE = 4 * 1024;

/** Nothing may be smaller than this; a chunk per byte would be absurd. */
const MIN_CHUNK_SIZE = 256;

/** How long one 4 KiB chunk may take to drain before the port is declared dead. */
export const SERIAL_CHUNK_TIMEOUT_MS = 30_000;

/** Floor for the whole-payload deadline — a short write still gets a minute. */
export const SERIAL_OVERALL_TIMEOUT_FLOOR_MS = 60_000;

/** Ceiling, so a nonsense payload size cannot produce an unbounded wait. */
export const SERIAL_OVERALL_TIMEOUT_CAP_MS = 30 * 60_000;

/**
 * Budget per 8 KiB of payload.
 *
 * 115200/8/N/1 carries ~11.5 KB/s, so 8 KiB actually costs ~700ms; a round
 * 1000ms leaves about 40% headroom for XOFF pauses and flash commits. A 2.45MB
 * font works out to ~5min of budget against ~3.5min of real transfer.
 */
export const SERIAL_MS_PER_8KIB = 1_000;

/** How long to wait for a ^HW / ~HI reply that may never come. See collect(). */
export const SERIAL_QUERY_TIMEOUT_MS = 12_000;

/** Opening a port is either immediate or wrong; this only catches a wedged driver. */
export const SERIAL_OPEN_TIMEOUT_MS = 10_000;

/** Clamp a requested chunk size into the range this transport will write. */
export function resolveSerialChunkSize(requested?: number): number {
  if (!requested || !Number.isFinite(requested)) return SERIAL_CHUNK_SIZE;
  return Math.min(SERIAL_CHUNK_SIZE, Math.max(MIN_CHUNK_SIZE, Math.floor(requested)));
}

/**
 * Deadline for a whole payload: ~1s per 8 KiB, never under a minute, never
 * over half an hour.
 */
export function serialOverallTimeoutMs(payloadBytes: number): number {
  const bytes = Number.isFinite(payloadBytes) && payloadBytes > 0 ? payloadBytes : 0;
  const scaled = Math.ceil(bytes / 8192) * SERIAL_MS_PER_8KIB;
  return Math.min(
    SERIAL_OVERALL_TIMEOUT_CAP_MS,
    Math.max(SERIAL_OVERALL_TIMEOUT_FLOOR_MS, scaled),
  );
}

/** Start offsets of each chunk of `total` bytes. Empty for an empty payload. */
export function chunkOffsets(total: number, chunkSize: number = SERIAL_CHUNK_SIZE): number[] {
  const size = resolveSerialChunkSize(chunkSize);
  const offsets: number[] = [];
  for (let at = 0; at < total; at += size) offsets.push(at);
  return offsets;
}

// ---------------------------------------------------------------------------
// The injected port
// ---------------------------------------------------------------------------

/**
 * The slice of a serialport `SerialPort` this transport uses.
 *
 * Narrow and callback-shaped rather than the EventEmitter surface, so the
 * adapter in `ipc/zpl-font.ts` can satisfy it explicitly (no `as any`) and a
 * test can satisfy it with twenty lines of fake.
 */
export interface SerialPortLike {
  /** Path this port was opened on, for error messages. */
  readonly path: string;
  write(data: Uint8Array, callback: (err?: Error | null) => void): boolean;
  /** Resolves when the OS has handed every written byte to the UART. */
  drain(callback: (err?: Error | null) => void): void;
  /** Drain, then close, then release whatever the opener acquired. */
  close(): Promise<void>;
  /** Tear the port down without draining, and release. Must never throw. */
  destroy(err?: Error): void;
  onData(listener: (chunk: Uint8Array) => void): () => void;
  onError(listener: (err: Error) => void): () => void;
  onClose(listener: () => void): () => void;
}

/**
 * Opens a port at 115200/8/N/1 with XON/XOFF and DTR/RTS asserted, and holds
 * whatever exclusivity guard the host app has, releasing it on close/destroy.
 */
export type OpenSerialPort = (path: string) => Promise<SerialPortLike>;

export interface SerialLinkOptions {
  open: OpenSerialPort;
  chunkSize?: number;
  chunkTimeoutMs?: number;
  /** Overrides the payload-scaled deadline. Tests use it; production does not. */
  overallTimeoutMs?: number;
  queryTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// The connection
// ---------------------------------------------------------------------------

export class SerialPrinterConnection implements PrinterLink {
  #port: SerialPortLike;
  #chunkSize: number;
  #chunkTimeoutMs: number;
  #deadline: number;
  #received: Uint8Array[] = [];
  #closed = false;
  #error: Error | null = null;
  #detach: (() => void)[] = [];

  private constructor(port: SerialPortLike, opts: SerialLinkOptions, payloadBytes: number) {
    this.#port = port;
    this.#chunkSize = resolveSerialChunkSize(opts.chunkSize);
    this.#chunkTimeoutMs = opts.chunkTimeoutMs ?? SERIAL_CHUNK_TIMEOUT_MS;
    this.#deadline = Date.now() + (opts.overallTimeoutMs ?? serialOverallTimeoutMs(payloadBytes));

    this.#detach.push(port.onData((chunk) => this.#received.push(chunk)));
    this.#detach.push(
      port.onError((err) => {
        this.#error ??= err;
      }),
    );
    this.#detach.push(
      port.onClose(() => {
        this.#closed = true;
      }),
    );
  }

  /**
   * `payloadBytes` is what the caller is about to send; it only sizes the
   * overall deadline. A query passes nothing and gets the one-minute floor.
   */
  static async open(
    path: string,
    opts: SerialLinkOptions,
    payloadBytes = 0,
  ): Promise<SerialPrinterConnection> {
    const port = await opts.open(path);
    return new SerialPrinterConnection(port, opts, payloadBytes);
  }

  /** Bytes per write — the caller reads chunks off disk at this size too. */
  get chunkSize(): number {
    return this.#chunkSize;
  }

  async write(data: string | Uint8Array): Promise<void> {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    for (const at of chunkOffsets(bytes.length, this.#chunkSize)) {
      this.#assertDeadline();
      await this.#writeChunk(bytes.subarray(at, Math.min(at + this.#chunkSize, bytes.length)));
    }
  }

  #assertDeadline(): void {
    if (this.#error) throw this.#error;
    if (this.#closed) throw new Error(`serial port ${this.#port.path} closed`);
    if (Date.now() > this.#deadline) {
      this.#port.destroy();
      throw new Error(
        `serial transfer on ${this.#port.path} ran past its deadline — ` +
          `the printer is accepting bytes far slower than 115200 baud allows`,
      );
    }
  }

  /**
   * One chunk, settled by whichever comes first: the drain callback, an error,
   * the port closing, or the timeout.
   *
   * A serial port that stops accepting data produces no event at all — the
   * write sits in the OS buffer and the drain callback never fires — so the
   * timer is the only thing that can end that wait.
   */
  #writeChunk(chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const offError = this.#port.onError((err) => finish(err));
      const offClose = this.#port.onClose(() =>
        finish(new Error(`serial port ${this.#port.path} closed mid-transfer`)),
      );

      const timer = setTimeout(() => {
        // Destroy rather than close: the printer is mid-~DY and still counting
        // bytes, so the port must not be left usable by the next job.
        this.#port.destroy();
        finish(
          new Error(
            `serial port ${this.#port.path} accepted no data for ${this.#chunkTimeoutMs}ms — ` +
              `the printer may be paused, out of media, powered off, or not wired for flow control`,
          ),
        );
      }, this.#chunkTimeoutMs);
      // Not unref'd, deliberately. This timer is the only thing that can end a
      // wait on a port that has gone quiet, so it has to be allowed to fire.

      function finish(err?: Error | null): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        offError();
        offClose();
        if (err) reject(err);
        else resolve();
      }

      this.#port.write(chunk, (writeErr) => {
        if (writeErr) return finish(writeErr);
        this.#port.drain((drainErr) => finish(drainErr));
      });
    });
  }

  /** Confirm nothing fell over while the last bytes were on the wire. */
  async settle(ms = 250): Promise<void> {
    await sleep(ms);
    if (this.#error) throw this.#error;
    if (this.#closed) {
      throw new Error(
        `serial port ${this.#port.path} closed before the transfer was acknowledged`,
      );
    }
  }

  /**
   * Collect a reply, or decide there is not going to be one.
   *
   * Returning "" is a legitimate outcome, not a failure — a Bixolon XD3/XD5
   * answers no query at all, and a printer wired with only TX cannot answer one
   * even if it wanted to. `service.ts` reads an empty string as "work blind".
   * That is why `maxMs` here is measured in seconds rather than fractions of
   * one: the whole cost of guessing wrong is paid on this call.
   */
  async collect(opts: CollectOptions = {}): Promise<string> {
    const { idleMs = 800, maxMs = SERIAL_QUERY_TIMEOUT_MS } = opts;
    const until = Date.now() + maxMs;
    let lastSize = -1;
    let quietSince = Date.now();

    while (Date.now() < until) {
      const size = this.#received.reduce((n, c) => n + c.length, 0);
      if (size !== lastSize) {
        lastSize = size;
        quietSince = Date.now();
      } else if (size > 0 && Date.now() - quietSince >= idleMs) {
        break;
      } else if (this.#closed) {
        break;
      }
      await sleep(25);
    }

    if (this.#error) throw this.#error;
    return Buffer.concat(this.#received.map((c) => Buffer.from(c))).toString("latin1");
  }

  async close(): Promise<void> {
    for (const off of this.#detach.splice(0)) off();
    if (this.#closed) return;
    this.#closed = true;
    try {
      await withTimeout(this.#port.close(), 5_000);
    } catch {
      // A close that hangs or errors still has to release the port; destroy is
      // the only thing left that can, and it must not mask the real outcome of
      // the transfer that just finished.
      this.#port.destroy();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

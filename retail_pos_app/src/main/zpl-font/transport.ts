/**
 * Raw TCP transport for ZPL printers.
 *
 * Separate from the app's existing label transport on purpose. `ipc/label.ts`
 * writes a whole label in one `socket.write()` under a 5s timeout, which is
 * right for a few kilobytes and impossible for a 6MB font: at the ~560 KB/s a
 * ZD421 actually accepts, one weight takes about eleven seconds. This layer
 * streams with backpressure and bounds each chunk instead.
 */

import net from "node:net";

export const DEFAULT_PORT = 9100;

export interface ConnectOptions {
  host: string;
  port: number;
  connectTimeoutMs?: number;
  /**
   * Give up if a single chunk has not been accepted in this long.
   *
   * A printer that stops reading — paused, out of media, or gone — leaves the
   * write sitting in the kernel buffer with no event to wake us. Generous
   * enough that a printer pausing to commit megabytes to flash is not mistaken
   * for a failure.
   */
  writeTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_WRITE_TIMEOUT_MS = 20_000;

export interface CollectOptions {
  /** Stop once the printer has been silent this long. */
  idleMs?: number;
  /** Hard ceiling on the whole collect, silent or not. */
  maxMs?: number;
}

export class PrinterConnection {
  #socket: net.Socket;
  #chunks: Buffer[] = [];
  #closed = false;
  #error: Error | null = null;
  #writeTimeoutMs: number;

  private constructor(socket: net.Socket, writeTimeoutMs: number) {
    this.#socket = socket;
    this.#writeTimeoutMs = writeTimeoutMs;
    socket.on("data", (chunk) => this.#chunks.push(chunk as Buffer));
    socket.on("error", (err) => {
      this.#error = err;
    });
    socket.on("close", () => {
      this.#closed = true;
    });
  }

  static connect(opts: ConnectOptions): Promise<PrinterConnection> {
    const {
      host,
      port,
      connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
      writeTimeoutMs = DEFAULT_WRITE_TIMEOUT_MS,
    } = opts;

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`timed out connecting to ${host}:${port} after ${connectTimeoutMs}ms`));
      }, connectTimeoutMs);

      socket.once("connect", () => {
        clearTimeout(timer);
        socket.setNoDelay(true);
        resolve(new PrinterConnection(socket, writeTimeoutMs));
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`cannot reach ${host}:${port}: ${err.message}`, { cause: err }));
      });
    });
  }

  /**
   * Write a chunk, waiting for drain so a multi-megabyte font does not pile up
   * in memory.
   *
   * Every outcome has to settle the promise. A peer that disappears mid-chunk
   * fires neither the write callback nor `drain`, so `close` and `error` are
   * wired up as exits too — and because whether those events arrive at all is a
   * race with the kernel, a timeout backstops them. Without it a dead printer
   * hangs the transfer instead of failing it.
   */
  write(data: string | Uint8Array): Promise<void> {
    if (this.#error) return Promise.reject(this.#error);
    if (this.#closed) return Promise.reject(new Error("printer closed the connection"));

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        this.#socket.destroy();
        finish(
          new Error(
            `printer accepted no data for ${this.#writeTimeoutMs}ms — it may be paused, out of media, or gone`,
          ),
        );
      }, this.#writeTimeoutMs);
      (timer as { unref?: () => void }).unref?.();

      const finish = (err?: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#socket.off("error", onError);
        this.#socket.off("close", onClose);
        this.#socket.off("drain", onDrain);
        if (err) reject(err);
        else resolve();
      };
      const onError = (err: Error) => finish(err);
      const onClose = () => finish(new Error("printer closed the connection during write"));
      const onDrain = () => finish();

      this.#socket.on("error", onError);
      this.#socket.on("close", onClose);

      let flushed = false;
      flushed = this.#socket.write(data as never, (err) => {
        if (err) finish(err);
        else if (flushed) finish();
      });
      if (!flushed) this.#socket.on("drain", onDrain);
    });
  }

  /**
   * Confirm the printer is still there after a delay.
   *
   * Writes land in the kernel send buffer, so a printer that hung up partway
   * through would otherwise look like a clean transfer.
   */
  async settle(ms = 250): Promise<void> {
    await sleep(ms);
    if (this.#error) throw this.#error;
    if (this.#closed) {
      throw new Error("printer closed the connection before the transfer was acknowledged");
    }
  }

  /**
   * Collect a reply.
   *
   * Printers hold the connection open after answering, so there is no EOF to
   * wait for — a quiet period is the only end marker available.
   */
  async collect(opts: CollectOptions = {}): Promise<string> {
    const { idleMs = 400, maxMs = 8_000 } = opts;
    const deadline = Date.now() + maxMs;
    let lastSize = -1;
    let quietSince = Date.now();

    while (Date.now() < deadline) {
      const size = this.#chunks.reduce((n, c) => n + c.length, 0);
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
    return Buffer.concat(this.#chunks).toString("latin1");
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.#closed || this.#socket.destroyed) return resolve();
      this.#socket.once("close", () => resolve());
      this.#socket.end();
      const timer = setTimeout(() => {
        this.#socket.destroy();
        resolve();
      }, 1_000);
      (timer as { unref?: () => void }).unref?.();
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Open a connection, run `fn`, and always close — even on failure. */
export async function withConnection<T>(
  opts: ConnectOptions,
  fn: (conn: PrinterConnection) => Promise<T>,
): Promise<T> {
  const conn = await PrinterConnection.connect(opts);
  try {
    return await fn(conn);
  } finally {
    await conn.close();
  }
}

/** Send one command and read the reply. */
export function query(
  opts: ConnectOptions,
  command: string,
  collectOpts?: CollectOptions,
): Promise<string> {
  return withConnection(opts, async (conn) => {
    await conn.write(command);
    return conn.collect(collectOpts);
  });
}

/** Send a payload and do not wait for a reply. */
export async function send(opts: ConnectOptions, payload: string | Uint8Array): Promise<void> {
  await withConnection(opts, async (conn) => {
    await conn.write(payload);
  });
}

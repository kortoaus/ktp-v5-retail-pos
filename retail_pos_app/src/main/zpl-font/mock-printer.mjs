/**
 * A ZD421 stand-in for tests.
 *
 * Mimics the three behaviours that make ~DY awkward: it swallows exactly `t`
 * bytes of payload without interpreting them, it holds the connection open
 * after answering a query instead of sending EOF, and under `{ silent: true }`
 * it answers nothing at all — a Bixolon XD3/XD5 in BPL-Z, which takes every
 * command and never replies to one.
 */

import net from "node:net";

export class MockPrinter {
  objects = new Map();
  port = 0;

  #server;
  #sockets = new Set();
  #opts;

  constructor(opts = {}) {
    this.#opts = {
      dpmm: opts.dpmm ?? 8,
      model: opts.model ?? "ZD421-200dpi",
      firmware: opts.firmware ?? "V93.21.37Z",
      capacityBytes: opts.capacityBytes ?? 64 * 1024 * 1024,
      brokenIdentity: opts.brokenIdentity ?? false,
      // A ZD421 on V93.21.37Z answered ^HW with entries and no free-space line.
      reportFreeSpace: opts.reportFreeSpace ?? true,
      // A Bixolon XD3/XD5 in BPL-Z: reads everything, stores ~DY objects, prints
      // labels — and answers ~HI/^HW/^HH with no bytes at all, ever.
      silent: opts.silent ?? false,
      stall: opts.stall ?? false,
      failAfterBytes: opts.failAfterBytes,
      truncateStoredBy: opts.truncateStoredBy ?? 0,
    };
    // pauseOnConnect keeps libuv from reading at all, so a stalled printer
    // really stops draining the socket instead of quietly buffering.
    this.#server = net.createServer({ pauseOnConnect: this.#opts.stall }, (socket) =>
      this.#handle(socket),
    );
  }

  async listen() {
    await new Promise((resolve) => this.#server.listen(0, "127.0.0.1", resolve));
    this.port = this.#server.address().port;
    return this.port;
  }

  get target() {
    return { host: "127.0.0.1", port: this.port };
  }

  async close() {
    // server.close() waits for live connections, and a stalled one never
    // notices our peer hanging up.
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    await new Promise((resolve) => this.#server.close(() => resolve()));
  }

  get freeBytes() {
    let used = 0;
    for (const size of this.objects.values()) used += size;
    return this.#opts.capacityBytes - used;
  }

  /** Pre-load an object as if a previous install had put it there. */
  seed(filename, size) {
    this.objects.set(filename, size);
  }

  #handle(socket) {
    this.#sockets.add(socket);
    socket.on("close", () => this.#sockets.delete(socket));
    socket.on("error", () => {});
    if (this.#opts.stall) return; // never resumed: nothing is read off the wire

    let buffer = Buffer.alloc(0);
    let receiving = null;
    let payloadSeen = 0;

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      for (;;) {
        if (receiving) {
          const take = Math.min(receiving.remaining, buffer.length);
          if (take === 0) return;

          if (this.#opts.failAfterBytes !== undefined) {
            payloadSeen += take;
            if (payloadSeen > this.#opts.failAfterBytes) {
              socket.destroy();
              return;
            }
          }

          receiving.received += take;
          receiving.remaining -= take;
          buffer = buffer.subarray(take);

          if (receiving.remaining === 0) {
            this.objects.set(
              receiving.filename,
              receiving.received - this.#opts.truncateStoredBy,
            );
            receiving = null;
          }
          continue;
        }

        const text = buffer.toString("latin1");
        const dy = text.match(
          /~DY([A-Za-z]):([A-Za-z0-9]{1,8}\.[A-Za-z0-9]{1,3}),([ABCP]),([A-Za-z]+),(\d+),(\d*),/,
        );
        const hi = text.indexOf("~HI");
        const hw = text.match(/\^XA\^HW([A-Za-z]:[^^]*)\^XZ/);
        const id = text.match(/\^XA\^ID([A-Za-z]):([A-Za-z0-9]{1,8}\.[A-Za-z0-9]{1,3})\^FS\^XZ/);
        const xz = text.indexOf("^XZ");

        const candidates = [
          dy?.index !== undefined ? { at: dy.index, kind: "dy" } : null,
          hi !== -1 ? { at: hi, kind: "hi" } : null,
          hw?.index !== undefined ? { at: hw.index, kind: "hw" } : null,
          id?.index !== undefined ? { at: id.index, kind: "id" } : null,
          xz !== -1 ? { at: xz, kind: "xz" } : null,
        ].filter(Boolean);

        if (!candidates.length) return;
        const next = candidates.reduce((a, b) => (b.at < a.at ? b : a));

        if (next.kind === "dy") {
          receiving = {
            filename: dy[2].toUpperCase(),
            remaining: Number(dy[5]),
            received: 0,
          };
          buffer = buffer.subarray(next.at + Buffer.byteLength(dy[0], "latin1"));
        } else if (next.kind === "hi") {
          this.#reply(socket, this.#identity());
          buffer = buffer.subarray(next.at + 3);
        } else if (next.kind === "hw") {
          this.#reply(socket, this.#directory());
          buffer = buffer.subarray(next.at + Buffer.byteLength(hw[0], "latin1"));
        } else if (next.kind === "id") {
          this.objects.delete(id[2].toUpperCase());
          buffer = buffer.subarray(next.at + Buffer.byteLength(id[0], "latin1"));
        } else {
          // A print job we do not model — consume it and record that it landed.
          // Decoded as UTF-8, not the latin1 used for scanning commands: label
          // bodies carry hangul, and latin1 would turn it into mojibake.
          this.lastPrintJob = buffer.subarray(0, next.at + 3).toString("utf8");
          buffer = buffer.subarray(next.at + 3);
        }
      }
    });
  }

  /**
   * Answer a query — unless this printer is one of the mute ones.
   *
   * Silence is modelled as "consumed the command, wrote nothing" rather than as
   * a dropped connection, because that is what the hardware does: the socket
   * stays up and the next command is still accepted.
   */
  #reply(socket, payload) {
    if (this.#opts.silent) return;
    socket.write(payload);
  }

  #identity() {
    if (this.#opts.brokenIdentity) return "\x02UNKNOWN RESPONSE\x03\r\n";
    const { model, firmware, dpmm } = this.#opts;
    return `\x02${model},${firmware},${dpmm},008192KB,X\x03\r\n`;
  }

  #directory() {
    const lines = [...this.objects.entries()].map(
      ([filename, size]) => `*E:${filename.padEnd(12)} ${String(size).padStart(8)}`,
    );
    if (this.#opts.reportFreeSpace) {
      lines.push(`-${this.freeBytes} bytes free E:FLASH`);
    }
    return `\x02${lines.join("\r\n")}\r\n\x03`;
  }
}

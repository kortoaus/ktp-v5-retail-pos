/**
 * One door to both transports.
 *
 * `service.ts` talks about printers, not about sockets or UARTs. This file is
 * the only place that knows a target can be either, so adding a third transport
 * later means touching this and nothing above it.
 */

import {
  PrinterConnection,
  type CollectOptions,
  type ConnectOptions,
  type PrinterLink,
} from "./transport";
import { SerialPrinterConnection, type SerialLinkOptions } from "./serial-transport";
import type { PrinterTarget } from "./target";

export interface LinkOptions {
  /** Tuning for TCP targets. */
  net?: Omit<ConnectOptions, "host" | "port">;
  /**
   * Tuning for serial targets, and the port opener itself.
   *
   * Absent means this build cannot reach serial printers at all — the library
   * imports no native module, so somebody has to hand it one.
   */
  serial?: SerialLinkOptions;
  /**
   * How many bytes the caller is about to push, if it knows.
   *
   * Only serial uses it, and only to size the overall deadline: a 2.5MB font at
   * 115200 baud needs minutes, and a deadline sized for a query would kill it.
   */
  payloadBytes?: number;
}

export async function openLink(target: PrinterTarget, opts: LinkOptions): Promise<PrinterLink> {
  if (target.type === "serial") {
    if (!opts.serial) {
      throw new Error(
        "no serial port opener was supplied — this build cannot install fonts over serial",
      );
    }
    return SerialPrinterConnection.open(target.path, opts.serial, opts.payloadBytes ?? 0);
  }
  return PrinterConnection.connect({ ...opts.net, host: target.host, port: target.port });
}

/** Open, run `fn`, and always close — even on failure. */
export async function withLink<T>(
  target: PrinterTarget,
  opts: LinkOptions,
  fn: (link: PrinterLink) => Promise<T>,
): Promise<T> {
  const link = await openLink(target, opts);
  try {
    return await fn(link);
  } finally {
    await link.close();
  }
}

/** Send one command and read whatever comes back — possibly nothing. */
export function query(
  target: PrinterTarget,
  opts: LinkOptions,
  command: string,
  collectOpts?: CollectOptions,
): Promise<string> {
  return withLink(target, opts, async (link) => {
    await link.write(command);
    return link.collect(collectOpts);
  });
}

/** Send a payload and do not wait for a reply. */
export async function send(
  target: PrinterTarget,
  opts: LinkOptions,
  payload: string | Uint8Array,
): Promise<void> {
  await withLink(target, { ...opts, payloadBytes: payloadLength(payload) }, async (link) => {
    await link.write(payload);
  });
}

function payloadLength(payload: string | Uint8Array): number {
  return typeof payload === "string" ? Buffer.byteLength(payload, "utf8") : payload.length;
}

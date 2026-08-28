/**
 * How a printer is addressed, and the two ways it can be.
 *
 * A label printer is either on the network (raw socket, port 9100) or on a
 * serial port. Everything else in this library is written against this union so
 * neither transport is the special case.
 *
 * Kept in its own file, importing nothing, because `types.ts` needs it and the
 * transports need it: a shared leaf avoids a cycle.
 */

/** A ZPL printer reached over a raw TCP socket. */
export interface NetPrinterTarget {
  type: "net";
  host: string;
  port: number;
}

/** A ZPL printer on a serial port — `COM3`, `/dev/ttyUSB0`. */
export interface SerialPrinterTarget {
  type: "serial";
  path: string;
}

export type PrinterTarget = NetPrinterTarget | SerialPrinterTarget;

/**
 * What callers may hand in.
 *
 * The bare `{ host, port }` is the shape this library had before serial
 * existed. It still arrives from a renderer built before the change and from
 * the existing tests, and coercing it costs one branch — cheaper than a
 * flag day between the main and renderer bundles.
 */
export type PrinterTargetInput = PrinterTarget | { host: string; port: number };

/** Coerce any accepted shape to the union, defaulting the legacy one to net. */
export function normalizeTarget(input: PrinterTargetInput): PrinterTarget {
  if ("type" in input) {
    if (input.type === "serial") {
      if (!input.path?.trim()) throw new Error("serial printer target has no port path");
      return { type: "serial", path: input.path };
    }
    return { type: "net", host: input.host, port: input.port };
  }
  return { type: "net", host: input.host, port: input.port };
}

/** Stable identity for busy-tracking and for matching progress events to rows. */
export function targetKey(target: PrinterTarget): string {
  return target.type === "serial" ? `serial:${target.path}` : `net:${target.host}:${target.port}`;
}

/** How the target is named to a person, in an error or on screen. */
export function describeTarget(target: PrinterTarget): string {
  return target.type === "serial" ? target.path : `${target.host}:${target.port}`;
}

export function sameTarget(a: PrinterTarget, b: PrinterTarget): boolean {
  return targetKey(a) === targetKey(b);
}

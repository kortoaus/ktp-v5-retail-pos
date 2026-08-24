/**
 * ZPL command builders and response parsers.
 *
 * Pure string in, string out — no sockets, no filesystem, no electron. This is
 * where the protocol details live so they can be tested without a printer.
 */

import type { PrinterIdentity } from "./types";

export type Drive = "R:" | "E:" | "B:" | "A:";

/** Strip STX/ETX/NUL framing that firmware wraps around query replies. */
function unframe(raw: string): string {
  return raw.replace(/[\x00\x02\x03]/g, "");
}

// ---------------------------------------------------------------------------
// ~DY — Download Objects
// ---------------------------------------------------------------------------

/** ~DY object names are 1-8 alphanumeric characters. */
export function assertObjectName(name: string): void {
  if (!/^[A-Z0-9]{1,8}$/.test(name)) {
    throw new Error(
      `invalid object name ${JSON.stringify(name)}: must be 1-8 uppercase alphanumeric characters`,
    );
  }
}

/**
 * Header for `~DYd:f,b,x,t,w,data`, to be followed by the raw font bytes.
 *
 * Zebra's own example is `~DYE:FONTFILE.TTF,B,T,SIZE,,` — the name carries the
 * extension and `w` is empty for fonts. Once this lands the printer consumes
 * exactly `t` bytes verbatim, ignoring every control prefix and flow-control
 * character, so the payload needs no escaping.
 */
export function downloadObjectHeader(
  drive: Drive,
  objectName: string,
  totalBytes: number,
): string {
  assertObjectName(objectName);
  if (!Number.isInteger(totalBytes) || totalBytes <= 0) {
    throw new Error(`total bytes must be a positive integer, got ${totalBytes}`);
  }
  return `~DY${drive}${objectName}.TTF,B,T,${totalBytes},,`;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function hostIdentification(): string {
  return "~HI";
}

export function hostDirectory(pattern = "E:*.*"): string {
  return `^XA^HW${pattern}^XZ`;
}

export function objectDelete(drive: Drive, filename: string): string {
  return `^XA^ID${drive}${filename}^FS^XZ`;
}

export interface DirectoryEntry {
  drive: string;
  /** `NAME.EXT` as stored on the printer. */
  filename: string;
  size: number;
}

export interface DirectoryListing {
  entries: DirectoryEntry[];
  /** Bytes free on the queried drive, or null if the printer did not say. */
  freeBytes: number | null;
}

/**
 * Parse a ^HW reply.
 *
 * Entry lines start with `*`; the listing ends with `-<n> bytes free <drive>`.
 * Column widths are fixed in the spec but firmware pads inconsistently, so this
 * matches tokens rather than columns. A ZD421 running V93.21.37Z returned a
 * usable entry list with no parseable free-space line, hence `freeBytes` being
 * nullable rather than a number every caller can rely on.
 */
export function parseDirectoryListing(raw: string): DirectoryListing {
  const entries: DirectoryEntry[] = [];
  let freeBytes: number | null = null;

  for (const line of unframe(raw).split(/\r?\n/)) {
    const entry = line.match(
      /^\s*\*\s*([A-Za-z]):([A-Za-z0-9_\-]{1,8}\.[A-Za-z0-9]{1,3})\s+(\d+)/,
    );
    if (entry) {
      entries.push({
        drive: `${entry[1].toUpperCase()}:`,
        filename: entry[2].toUpperCase(),
        size: Number(entry[3]),
      });
      continue;
    }
    const free = line.match(/^\s*-?(\d+)\s+bytes\s+free/i);
    if (free) freeBytes = Number(free[1]);
  }

  return { entries, freeBytes };
}

/**
 * Parse a ~HI reply of the form `MODEL,VERSION,DPMM,MEMORY,OPTIONS`.
 *
 * Returns null rather than guessing when the dots-per-millimetre field is not
 * one of the values a Zebra printhead actually has; callers then fall back to
 * an explicit dpi instead of silently laying out a label at the wrong scale.
 */
export function parsePrinterIdentity(raw: string): PrinterIdentity | null {
  const fields = unframe(raw).trim().split(",");
  if (fields.length < 3) return null;

  const dpmm = Number(fields[2]);
  if (![6, 8, 12, 24].includes(dpmm)) return null;

  return {
    model: fields[0].trim(),
    firmware: fields[1].trim(),
    dpmm,
    dpi: Math.round(dpmm * 25.4),
  };
}

// ---------------------------------------------------------------------------
// Field data
// ---------------------------------------------------------------------------

/**
 * Escape the three characters ZPL would otherwise take from ^FD data.
 *
 * `^` and `~` are command prefixes and `_` is the ^FH hex indicator; everything
 * else, multi-byte UTF-8 included, passes through for ^CI28 to interpret. The
 * field must be written as `^FH^FD...` for this to mean anything.
 *
 * Order matters: `_` goes first, or it would re-escape the underscores the
 * other two substitutions introduce.
 */
export function escapeFieldData(text: string): string {
  return text.replaceAll("_", "_5F").replaceAll("^", "_5E").replaceAll("~", "_7E");
}

// ---------------------------------------------------------------------------
// Proof label
// ---------------------------------------------------------------------------

export interface ProofLabelFont {
  /** Printer object filename, e.g. `NOTOKRM.TTF`. */
  filename: string;
  /** Human weight name for the caption. */
  weight: string;
}

export interface ProofLabelOptions {
  dpmm: number;
  widthMm: number;
  heightMm?: number;
  fonts: ProofLabelFont[];
  /** Sample line printed with each font. */
  sample?: string;
}

export const PROOF_SAMPLE = "가나다 한글 ABC 123";

/**
 * One label proving the downloaded fonts render.
 *
 * Two things are deliberate. The caption for each row uses the printer's own
 * ^A0 font, so a row whose sample is blank still says which weight failed. And
 * every row is packed into the top of the label rather than spread over it,
 * because short media clips from the bottom — without that, "the font did not
 * render" and "the paper ran out" produce the same blank space.
 */
export function proofLabel(opts: ProofLabelOptions): string {
  const { dpmm, widthMm, heightMm, fonts } = opts;
  const sample = opts.sample ?? PROOF_SAMPLE;

  const widthDots = Math.round(widthMm * dpmm);
  const scale = dpmm / 8; // constants below are authored for 8 dpmm
  const s = (n: number) => Math.round(n * scale);

  const margin = s(16);
  const out = ["^XA", "^CI28", `^PW${widthDots}`];
  if (heightMm) out.push(`^LL${Math.round(heightMm * dpmm)}`);
  out.push("^LH0,0");

  // Keep the sample inside the printable width: hangul is full-width, so the
  // cell count is a fair proxy for advance width.
  const usable = widthDots - margin * 2;
  const cells = Math.max(1, [...sample].length);
  const glyph = Math.max(s(14), Math.min(s(34), Math.floor(usable / cells)));

  let y = margin;
  for (const font of fonts) {
    out.push(
      `^FO${margin},${y}^A0N,${s(16)},${s(16)}^FH^FD${escapeFieldData(
        `${font.weight}  ${font.filename}`,
      )}^FS`,
    );
    y += s(20);
    out.push(
      `^FO${margin},${y}^A@N,${glyph},${glyph},E:${font.filename}^FH^FD${escapeFieldData(sample)}^FS`,
    );
    y += glyph + s(12);
  }

  out.push("^XZ");
  return out.join("\n");
}

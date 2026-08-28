/**
 * Public types for the ZPL font library.
 *
 * Deliberately self-contained: nothing here references ../types or any other
 * app module. The label pipeline is going to be rewritten, and this part must
 * not come apart with it.
 */

import { describeTarget, type PrinterTarget } from "./target";

export type {
  NetPrinterTarget,
  PrinterTarget,
  PrinterTargetInput,
  SerialPrinterTarget,
} from "./target";
export { describeTarget, normalizeTarget, sameTarget, targetKey } from "./target";

/** One weight the library can install. */
export interface FontSpec {
  /** Weight name as shown in the UI. */
  weight: string;
  /** Filename inside the injected font directory. */
  sourceFile: string;
  /** Printer object name — ~DY allows 1-8 alphanumeric characters. */
  objectName: string;
  /** Printer object filename, always `<objectName>.TTF`. */
  filename: string;
}

export type FontState =
  /** Present on the printer at exactly the bundled size. */
  | "installed"
  /** Not on the printer. */
  | "missing"
  /** Present but a different size — a partial or stale install. */
  | "mismatch"
  /** The printer answers no query, so nothing can be said about it. */
  | "unknown"
  /** Sent to a printer that answers no query — proven only by the proof label. */
  | "unverified";

export interface FontStatusEntry extends FontSpec {
  /** Size of the file shipped with the app. */
  bundledSize: number;
  /** Size the printer reports, or null when absent. */
  installedSize: number | null;
  state: FontState;
}

export interface PrinterIdentity {
  model: string;
  firmware: string;
  /** Dots per millimetre: 6, 8, 12 or 24. */
  dpmm: number;
  dpi: number;
}

/**
 * What the printer will tell us about itself.
 *
 * `responds: false` is a Bixolon XD3/XD5 in BPL-Z: it takes ~DY downloads and
 * draws `^A@` + `^CI28` hangul exactly like a Zebra, but answers `~HI`, `^HW`
 * and `^HH` with no bytes at all. That is a printer to work blind against, not
 * a failure — everything a query would have told us is simply unavailable, so
 * the proof label becomes the only verification there is.
 */
export interface PrinterCapabilities {
  /** Whether the printer answered the identity query at all. */
  responds: boolean;
  /** From ~HI when it answers; absent otherwise. */
  model?: string;
  /** From ~HI, or the caller's override; absent when neither is available. */
  dpi?: number;
}

export interface FontStatus {
  /** Null when ~HI could not be parsed; callers fall back to an explicit dpi. */
  identity: PrinterIdentity | null;
  capabilities: PrinterCapabilities;
  fonts: FontStatusEntry[];
  installedCount: number;
  totalCount: number;
  /** Null when the printer did not report free space in its ^HW reply. */
  freeBytes: number | null;
  /** Set when the state needs explaining to a person — blind mode does. */
  message?: string;
}

export interface StatusOptions {
  /** Resolution to assume when the printer will not report one. */
  dpi?: number;
}

export interface InstallProgress {
  /** 1-based position in this run. */
  index: number;
  /** How many fonts this run will send. */
  count: number;
  weight: string;
  filename: string;
  sentBytes: number;
  totalBytes: number;
}

export interface InstallOptions {
  /** Reinstall even when the printer already has a matching object. */
  force?: boolean;
  /** Only these weights; all of them when omitted. */
  weights?: string[];
  /**
   * Resolution for the proof label a blind install prints. Ignored by a
   * printer that answers ~HI, which reports its own.
   */
  dpi?: number;
  /** Media width for that proof label, in millimetres. Defaults to 100. */
  widthMm?: number;
  /** Media height for it; omitted leaves the printer's own setting. */
  heightMm?: number;
  onProgress?: (progress: InstallProgress) => void;
}

export interface InstallResult {
  /** Fonts actually sent in this run. */
  sent: FontSpec[];
  /** Fonts left alone because the printer already had them. */
  skipped: FontSpec[];
  elapsedMs: number;
  status: FontStatus;
  /**
   * True when the printer was re-read and confirmed the objects landed. False
   * for a blind install, where the proof label is the only evidence.
   */
  verified: boolean;
  /** Set when the outcome needs explaining — a blind install always does. */
  message?: string;
}

export interface TestPrintOptions {
  /** Label width in millimetres. */
  widthMm?: number;
  /** Label height in millimetres; omitted leaves the printer's own setting. */
  heightMm?: number;
  /** Overrides the resolution when ~HI cannot be read. */
  dpi?: number;
  /** Which weight to print; all installed ones when omitted. */
  weights?: string[];
}

export class PrinterBusyError extends Error {
  // Written out rather than declared as a constructor parameter property:
  // node's strip-only TypeScript mode cannot handle those, and these files are
  // executed directly by `node --test`.
  readonly target: PrinterTarget;

  constructor(target: PrinterTarget) {
    super(`a font transfer to ${describeTarget(target)} is already running`);
    this.name = "PrinterBusyError";
    this.target = target;
  }
}

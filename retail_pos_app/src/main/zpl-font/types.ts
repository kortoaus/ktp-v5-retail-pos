/**
 * Public types for the ZPL font library.
 *
 * Deliberately self-contained: nothing here references ../types or any other
 * app module. The label pipeline is going to be rewritten, and this part must
 * not come apart with it.
 */

/** A network ZPL printer, addressed by raw socket. */
export interface PrinterTarget {
  host: string;
  port: number;
}

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
  | "mismatch";

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

export interface FontStatus {
  /** Null when ~HI could not be parsed; callers fall back to an explicit dpi. */
  identity: PrinterIdentity | null;
  fonts: FontStatusEntry[];
  installedCount: number;
  totalCount: number;
  /** Null when the printer did not report free space in its ^HW reply. */
  freeBytes: number | null;
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
  onProgress?: (progress: InstallProgress) => void;
}

export interface InstallResult {
  /** Fonts actually sent in this run. */
  sent: FontSpec[];
  /** Fonts left alone because the printer already had them. */
  skipped: FontSpec[];
  elapsedMs: number;
  status: FontStatus;
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
    super(`a font transfer to ${target.host}:${target.port} is already running`);
    this.name = "PrinterBusyError";
    this.target = target;
  }
}

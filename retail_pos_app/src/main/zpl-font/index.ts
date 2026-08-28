/**
 * ZPL font library — installs Korean TrueType faces into a label printer's
 * flash so ZPL text fields can print hangul.
 *
 * Reaches the printer over TCP or over a serial port. Serial is the same
 * protocol at a two-hundredth of the speed: minutes per font instead of
 * seconds, which is why `serial-transport.ts` exists rather than a baud-rate
 * setting.
 *
 * Self-contained by design. Nothing under this directory imports from the rest
 * of the app, not even electron or serialport: the font directory and the
 * serial port opener are both passed in. The label pipeline it serves is going
 * to be rewritten, and this part has to survive that untouched.
 *
 * The only thing outside that knows about it is `ipc/zpl-font.ts`, which
 * resolves the packaged font directory and adapts these calls to IPC.
 *
 * Two printer families are supported and they differ in one way that shapes
 * this whole surface: a Zebra answers ~HI and ^HW, a Bixolon XD3/XD5 in BPL-Z
 * answers nothing while accepting everything. `FontStatus.capabilities.responds`
 * is that distinction; see README.md for what changes on each side of it.
 */

export { createZplFontService } from "./service";
export type { ZplFontService, ZplFontServiceOptions } from "./service";

export { FONTS, findFont, selectFonts } from "./catalog";

export {
  escapeFieldData,
  proofLabel,
  PROOF_SAMPLE,
  PROOF_BUILTIN_REFERENCE,
  PROOF_VERDICT,
  assertObjectName,
} from "./commands";

export { PrinterBusyError } from "./types";
export { describeTarget, normalizeTarget, sameTarget, targetKey } from "./target";
export type {
  NetPrinterTarget,
  PrinterTarget,
  PrinterTargetInput,
  SerialPrinterTarget,
} from "./target";

export {
  SERIAL_CHUNK_SIZE,
  SERIAL_CHUNK_TIMEOUT_MS,
  SERIAL_OPEN_TIMEOUT_MS,
  SERIAL_QUERY_TIMEOUT_MS,
  chunkOffsets,
  resolveSerialChunkSize,
  serialOverallTimeoutMs,
} from "./serial-transport";
export type { OpenSerialPort, SerialLinkOptions, SerialPortLike } from "./serial-transport";

export type {
  FontSpec,
  FontState,
  FontStatus,
  FontStatusEntry,
  InstallOptions,
  InstallProgress,
  InstallResult,
  PrinterCapabilities,
  PrinterIdentity,
  StatusOptions,
  TestPrintOptions,
} from "./types";

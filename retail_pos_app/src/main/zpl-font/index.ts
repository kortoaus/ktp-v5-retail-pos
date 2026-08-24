/**
 * ZPL font library — installs Korean TrueType faces into a network label
 * printer's flash so ZPL text fields can print hangul.
 *
 * Self-contained by design. Nothing under this directory imports from the rest
 * of the app, not even electron: the font directory is passed in. The label
 * pipeline it serves is going to be rewritten, and this part has to survive that
 * untouched.
 *
 * The only thing outside that knows about it is `ipc/zpl-font.ts`, which
 * resolves the packaged font directory and adapts these calls to IPC.
 */

export { createZplFontService } from "./service";
export type { ZplFontService, ZplFontServiceOptions } from "./service";

export { FONTS, findFont, selectFonts } from "./catalog";

export {
  escapeFieldData,
  proofLabel,
  PROOF_SAMPLE,
  assertObjectName,
} from "./commands";

export { PrinterBusyError } from "./types";
export type {
  FontSpec,
  FontState,
  FontStatus,
  FontStatusEntry,
  InstallOptions,
  InstallProgress,
  InstallResult,
  PrinterIdentity,
  PrinterTarget,
  TestPrintOptions,
} from "./types";

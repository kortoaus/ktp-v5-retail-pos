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
  PrinterTarget,
  StatusOptions,
  TestPrintOptions,
} from "./types";

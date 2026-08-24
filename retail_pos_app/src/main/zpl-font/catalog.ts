/**
 * The fonts this library installs and where their bytes come from.
 *
 * The directory is injected rather than resolved here — that keeps the library
 * free of any electron import, so it runs and is tested under plain node.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FontSpec } from "./types";

/**
 * Weights heavy enough to stay legible on thermal labels.
 *
 * TrueType (glyf), not the OpenType/CFF faces upstream also publishes: a ZD421
 * stored a CFF face at exactly the right byte count and then printed nothing
 * from it. Its own built-in fonts are all glyf.
 */
export const FONTS: readonly FontSpec[] = Object.freeze([
  { weight: "Medium", sourceFile: "NotoSansKR-Medium.ttf", objectName: "NOTOKRM", filename: "NOTOKRM.TTF" },
  { weight: "Bold", sourceFile: "NotoSansKR-Bold.ttf", objectName: "NOTOKRB", filename: "NOTOKRB.TTF" },
  { weight: "Black", sourceFile: "NotoSansKR-Black.ttf", objectName: "NOTOKRBK", filename: "NOTOKRBK.TTF" },
]);

export function findFont(nameOrWeight: string): FontSpec | undefined {
  const needle = nameOrWeight.toUpperCase();
  return FONTS.find(
    (f) => f.objectName === needle || f.weight.toUpperCase() === needle || f.filename === needle,
  );
}

/** Resolve `weights` to specs, or all of them when omitted. */
export function selectFonts(weights?: string[]): FontSpec[] {
  if (!weights?.length) return [...FONTS];
  return weights.map((w) => {
    const font = findFont(w);
    if (!font) {
      throw new Error(
        `unknown weight ${JSON.stringify(w)}; available: ${FONTS.map((f) => f.weight).join(", ")}`,
      );
    }
    return font;
  });
}

export interface BundledFont extends FontSpec {
  filePath: string;
  size: number;
}

/** sfnt magic for TrueType outlines. OpenType/CFF is `OTTO` and will not do. */
const TRUETYPE_MAGIC = 0x00010000;

/**
 * Read a bundled font's path and size, refusing anything the printer will not
 * draw.
 *
 * These files are packaged binaries, so a truncated or swapped one would
 * otherwise surface as a blank label long after the fact rather than here.
 */
export async function loadFont(fontDir: string, spec: FontSpec): Promise<BundledFont> {
  const filePath = path.join(fontDir, spec.sourceFile);

  const stats = await stat(filePath).catch(() => null);
  if (!stats?.isFile()) {
    throw new Error(`font file not found: ${filePath}`);
  }

  const head = await readFile(filePath, { flag: "r" }).then((b) => b.subarray(0, 4));
  if (head.length < 4 || head.readUInt32BE(0) !== TRUETYPE_MAGIC) {
    const tag = head.toString("latin1");
    throw new Error(
      `${spec.sourceFile} does not carry TrueType outlines (magic ${JSON.stringify(tag)}); ` +
        `this printer family stores such a face and then prints nothing from it`,
    );
  }

  return { ...spec, filePath, size: stats.size };
}

export function loadFonts(fontDir: string, specs: FontSpec[] = [...FONTS]): Promise<BundledFont[]> {
  return Promise.all(specs.map((spec) => loadFont(fontDir, spec)));
}

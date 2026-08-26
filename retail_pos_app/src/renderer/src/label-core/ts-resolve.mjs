/**
 * Test-only resolver: lets `node --test` follow this library's extensionless
 * relative imports.
 *
 * Same problem and same fix as `src/main/zpl-font/ts-resolve.mjs`: vite
 * resolves `./measure` when it builds, but node's ESM loader wants a real
 * filename, and writing `.ts` into the imports is not open to us — the shared
 * tsconfig emits, so it rejects TypeScript extensions in specifiers. This fills
 * the extension in only when resolution would otherwise fail.
 *
 * It is test scaffolding, not part of the library: nothing under `label-core/`
 * imports it, so the "no node, no DOM, no electron" rule still holds for every
 * file that gets copied to the other repos.
 *
 *   node --experimental-strip-types --import ./src/renderer/src/label-core/ts-resolve.mjs \
 *     --test src/renderer/src/label-core/*.test.mjs
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const CANDIDATES = [".ts", "/index.ts"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith(".") || !context.parentURL) throw err;
      for (const suffix of CANDIDATES) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(fileURLToPath(url))) {
          return { url: url.href, format: "module-typescript", shortCircuit: true };
        }
      }
      throw err;
    }
  },
});

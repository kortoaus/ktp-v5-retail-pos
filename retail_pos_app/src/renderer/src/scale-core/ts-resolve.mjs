/**
 * Test-only resolver: lets `node --test` follow this library's extensionless
 * relative imports.
 *
 * A verbatim copy of `../label-core/ts-resolve.mjs`, and copied rather than
 * imported on purpose: `scale-core/` may not import anything outside itself, so
 * the scaffolding that runs its tests cannot reach across either.
 *
 * It is test scaffolding, not part of the library — nothing under `scale-core/`
 * imports it, so the "no node, no DOM, no electron" rule still holds for every
 * file that gets copied to the runner.
 *
 *   node --experimental-strip-types --import ./src/renderer/src/scale-core/ts-resolve.mjs \
 *     --test src/renderer/src/scale-core/*.test.mjs
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

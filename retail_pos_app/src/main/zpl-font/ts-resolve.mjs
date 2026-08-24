/**
 * Test-only resolver: lets `node --test` follow this library's extensionless
 * relative imports.
 *
 * electron-vite resolves `./commands` when it builds, but node's ESM loader
 * requires a real filename. Rather than write `.ts` into every import — which
 * the shared tsconfig would reject, since it emits — this fills in the
 * extension when resolution would otherwise fail. It lives inside the library
 * so the boundary stays intact: no shared config is touched to test this.
 *
 *   node --import ./src/main/zpl-font/ts-resolve.mjs --test <files>
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

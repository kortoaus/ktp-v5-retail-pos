import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      const lastSegment = specifier.split("/").at(-1) ?? "";
      const hasExtension = /\\.[a-zA-Z0-9]+$/.test(lastSegment);

      if (isRelative && !hasExtension) {
        try {
          return await nextResolve(specifier, context);
        } catch (error) {
          if (error && error.code === "ERR_MODULE_NOT_FOUND") {
            return nextResolve(\`\${specifier}.ts\`, context);
          }
          throw error;
        }
      }

      return nextResolve(specifier, context);
    }
  `)}`,
);

const {
  PICKUP_WORK_LABEL_BLACK_THRESHOLD,
  PICKUP_WORK_LABEL_SLCS_SLICE_HEIGHT,
  buildPickupWorkLabelSlcsGraphicLabel,
  buildPickupWorkLabelZplGraphicLabel,
} = await import("../../src/renderer/src/libs/pickup-work-label/output.ts");

function fakeRaster() {
  return {
    width: 800,
    height: 800,
    widthBytes: 100,
    data: new Uint8Array(100 * 800),
  };
}

test("pickup output constants match the current 800x800 canvas plan", () => {
  assert.equal(PICKUP_WORK_LABEL_BLACK_THRESHOLD, 220);
  assert.equal(PICKUP_WORK_LABEL_SLCS_SLICE_HEIGHT, 256);
});

test("buildPickupWorkLabelZplGraphicLabel emits 800x800 ZPL graphic image", () => {
  const zpl = buildPickupWorkLabelZplGraphicLabel(fakeRaster());

  assert.equal(zpl.startsWith("^XA^PW800^LL800^FO0,0^GFA,"), true);
  assert.equal(zpl.endsWith("^FS^XZ"), true);
  assert.match(zpl, /\^GFA,80000,80000,100,/);
});

test("buildPickupWorkLabelSlcsGraphicLabel emits 800x800 SLCS graphic image slices", () => {
  const parts = buildPickupWorkLabelSlcsGraphicLabel(fakeRaster());

  assert.deepEqual(parts[0], {
    type: "raw",
    data: "@\r\nCB\r\nSW800\r\nSL800\r\n",
  });
  assert.deepEqual(parts.at(-1), { type: "raw", data: "P1\r\n" });

  const byteParts = parts.filter((part) => part.type === "bytes");
  assert.equal(byteParts.length, 4);
  for (const bytePart of byteParts) {
    assert.equal(bytePart.data[0], 0x4c);
    assert.equal(bytePart.data[1], 0x44);
  }
});

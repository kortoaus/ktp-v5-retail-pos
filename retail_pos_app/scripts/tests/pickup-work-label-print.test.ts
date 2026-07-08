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
  PICKUP_WORK_LABEL_MEDIA_SIZE,
  getPickupWorkLabelPrintCount,
  getPickupWorkLabelPrinters,
} = await import("../../src/renderer/src/libs/pickup-work-label/print.ts");

test("PICKUP_WORK_LABEL_MEDIA_SIZE is the Interface Settings 100x100 value", () => {
  assert.equal(PICKUP_WORK_LABEL_MEDIA_SIZE, "100100");
});

test("getPickupWorkLabelPrinters returns only configured 100x100 printers in order", () => {
  const printers = [
    {
      type: "serial",
      name: "70x90 serial",
      language: "slcs",
      mediaSize: "7090",
      path: "/dev/tty.usbserial-a",
    },
    {
      type: "serial",
      name: "Pickup serial",
      language: "slcs",
      mediaSize: "100100",
      path: "/dev/tty.usbserial-b",
    },
    {
      type: "net",
      name: "No media",
      language: "zpl",
      host: "192.168.1.51",
      port: 9100,
    },
    {
      type: "net",
      name: "Pickup network",
      language: "zpl",
      mediaSize: "100100",
      host: "192.168.1.52",
      port: 9100,
    },
  ];

  assert.deepEqual(
    getPickupWorkLabelPrinters(printers).map((printer) => printer.name),
    ["Pickup serial", "Pickup network"],
  );
});

test("getPickupWorkLabelPrintCount rounds scaled pickup quantities up to at least one", () => {
  assert.equal(getPickupWorkLabelPrintCount(0), 1);
  assert.equal(getPickupWorkLabelPrintCount(1), 1);
  assert.equal(getPickupWorkLabelPrintCount(999), 1);
  assert.equal(getPickupWorkLabelPrintCount(1000), 1);
  assert.equal(getPickupWorkLabelPrintCount(1001), 2);
  assert.equal(getPickupWorkLabelPrintCount(3000), 3);
});

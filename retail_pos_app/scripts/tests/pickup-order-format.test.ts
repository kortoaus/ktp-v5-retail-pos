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
  countSelectedOptions,
  formatPickupMoney,
  formatPickupQty,
  normalizeSelectedOptionGroups,
  statusLabel,
} = await import(
  "../../src/renderer/src/components/pickupOrders/pickup-order-format.ts"
);

test("normalizeSelectedOptionGroups drops invalid top-level values", () => {
  assert.deepEqual(normalizeSelectedOptionGroups(null), []);
  assert.deepEqual(normalizeSelectedOptionGroups({}), []);
});

test("normalizeSelectedOptionGroups keeps valid groups and drops invalid children", () => {
  const groups = normalizeSelectedOptionGroups([
    {
      optionGroupId: 1,
      key: "build",
      name_en: "Build",
      name_ko: "구성",
      type: "QUANTITY",
      selectedOptions: [
        {
          key: "salmon",
          name_en: "Salmon",
          name_ko: "연어",
          qty: 8000,
          priceDelta: 0,
        },
        { key: "bad" },
      ],
    },
    { optionGroupId: 2, key: "bad", type: "UNKNOWN", selectedOptions: [] },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].selectedOptions.length, 1);
  assert.equal(countSelectedOptions(groups), 1);
});

test("format helpers use POS scaled integer conventions", () => {
  assert.equal(formatPickupMoney(1299), "$12.99");
  assert.equal(formatPickupQty(1000, "ea"), "1 ea");
  assert.equal(formatPickupQty(1250, "kg"), "1.25 kg");
  assert.equal(statusLabel("ORDER_CONFIRMED"), "ORDER CONFIRMED");
});

import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "./SalesStore.helper") {
        return nextResolve("./SalesStore.helper.ts", context);
      }
      if (specifier === "../types/sales") {
        return {
          shortCircuit: true,
          url: "data:text/javascript,export const SaleLineItem = undefined; export const SaleLineType = undefined; export const PPMarkdown = undefined;",
        };
      }
      if (specifier === "../libs/item-utils") {
        return {
          shortCircuit: true,
          url: "data:text/javascript,export const ItemTypes = undefined;",
        };
      }
      if (specifier === "./models") {
        return {
          shortCircuit: true,
          url: "data:text/javascript,export const Price = undefined; export const PromoPrice = undefined;",
        };
      }
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

const { buildNewLine, createEmptyCart, findMergeTarget } = await import(
  "../../src/renderer/src/store/SalesStore.helper.ts"
);
const { useSalesStore } = await import("../../src/renderer/src/store/SalesStore.ts");
const { invoiceRowToLine } = await import(
  "../../src/renderer/src/libs/sale/invoice-row-to-line.ts"
);

const item = {
  type: "normal",
  itemId: 501,
  name_en: "Salmon Bowl",
  name_ko: "연어 덮밥",
  price: { prices: [1299] },
  promoPrice: null,
  taxable: true,
  isPointExcluded: false,
  uom: "ea",
  barcode: "9330001112223",
};

test("buildNewLine stores pickupOrderId from AddLineOptions", () => {
  const line = buildNewLine(item, 0, 0, { pickupOrderId: 260708869 });
  assert.equal(line.pickupOrderId, 260708869);
});

test("buildNewLine defaults pickupOrderId to null", () => {
  const line = buildNewLine(item, 0, 0);
  assert.equal(line.pickupOrderId, null);
});

test("buildNewLine normalizes invalid pickupOrderId values to null", () => {
  const cases = [0, -1, 1.2, Number.NaN];

  for (const value of cases) {
    const line = buildNewLine(item, 0, 0, { pickupOrderId: value });
    assert.equal(line.pickupOrderId, null, String(value));
  }
});

test("findMergeTarget merges only matching pickup order identity", () => {
  const orderA = buildNewLine(item, 0, 0, { pickupOrderId: 260708869 });
  const normal = buildNewLine(item, 0, 1);

  assert.equal(
    findMergeTarget([orderA, normal], item, 0, { pickupOrderId: 260708869 }),
    0,
  );
  assert.equal(
    findMergeTarget([orderA, normal], item, 0, { pickupOrderId: 260708870 }),
    -1,
  );
  assert.equal(findMergeTarget([orderA, normal], item, 0, undefined), 1);
});

test("invoiceRowToLine sets pickupOrderId to null for repay/refund rows", () => {
  const line = invoiceRowToLine({
    id: 9001,
    index: 0,
    type: "NORMAL",
    itemId: 501,
    name_en: "Salmon Bowl",
    name_ko: "연어 덮밥",
    barcode: "9330001112223",
    uom: "ea",
    taxable: true,
    isPointExcluded: false,
    unit_price_original: 1299,
    unit_price_discounted: null,
    unit_price_adjusted: null,
    unit_price_effective: 1299,
    qty: 1000,
    measured_weight: null,
    total: 1299,
    tax_amount: 118,
    net: 1181,
    adjustments: [],
    ppMarkdownType: null,
    ppMarkdownAmount: null,
    originalInvoiceId: null,
    originalInvoiceRowId: null,
    refunded_qty: 0,
    surcharge_share: 0,
  });

  assert.equal(line.pickupOrderId, null);
});

test("useSalesStore.addLine merges by pickup order identity", () => {
  useSalesStore.setState((state) => ({
    ...state,
    activeCartIndex: 0,
    carts: Array.from({ length: state.cartCount }, createEmptyCart),
    lineOffset: 0,
  }));

  const { addLine } = useSalesStore.getState();

  addLine(item, { pickupOrderId: 260708869 });
  addLine(item, { pickupOrderId: 260708869 });
  addLine(item, { pickupOrderId: 260708870 });
  addLine(item);
  addLine(item);

  const lines = useSalesStore.getState().carts[0].lines;

  assert.equal(lines.length, 3);
  assert.equal(lines[0].pickupOrderId, 260708869);
  assert.equal(lines[0].qty, 2000);
  assert.equal(lines[1].pickupOrderId, 260708870);
  assert.equal(lines[1].qty, 1000);
  assert.equal(lines[2].pickupOrderId, null);
  assert.equal(lines[2].qty, 2000);
});

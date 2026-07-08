import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "../../service/pickup-order.service") {
        return {
          shortCircuit: true,
          url: "data:text/javascript,export async function updatePickupOrderStatus(){ return { ok: true, msg: 'ok', result: null }; }",
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
            return nextResolve(specifier + ".ts", context);
          }
          throw error;
        }
      }
      return nextResolve(specifier, context);
    }
  `)}`,
);

const { completePickupOrdersAfterSale, getDistinctPickupOrderIds } =
  await import("../../src/renderer/src/libs/pickup-order/auto-complete.ts");

test("getDistinctPickupOrderIds derives unique finite ids with new Set order", () => {
  const ids = getDistinctPickupOrderIds([
    { pickupOrderId: 260708869 },
    { pickupOrderId: null },
    { pickupOrderId: 260708869 },
    { pickupOrderId: 260708870 },
    { pickupOrderId: Number.NaN },
  ]);

  assert.deepEqual(ids, [260708869, 260708870]);
});

test("completePickupOrdersAfterSale continues after failures", async () => {
  const calls: Array<{ id: number; status: string }> = [];
  const failures = await completePickupOrdersAfterSale(
    [260708869, 260708870, 260708871],
    async (id, status) => {
      calls.push({ id, status });
      return id === 260708870
        ? { ok: false, msg: "not ready", result: null }
        : { ok: true, msg: "ok", result: {} };
    },
  );

  assert.deepEqual(calls, [
    { id: 260708869, status: "COMPLETED" },
    { id: 260708870, status: "COMPLETED" },
    { id: 260708871, status: "COMPLETED" },
  ]);
  assert.deepEqual(failures, [{ id: 260708870, message: "not ready" }]);
});

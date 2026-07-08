import assert from "node:assert/strict";
import test from "node:test";

import {
  createGetStoreLabelSettingService,
  formatStoreLabelAddress,
} from "./store.service";

test("formatStoreLabelAddress builds a compact one-line label address", () => {
  assert.equal(
    formatStoreLabelAddress({
      address1: "42-50 Rowe St.",
      address2: null,
      suburb: "Eastwood",
      state: "NSW",
      postcode: "2122",
    }),
    "42-50 Rowe St. Eastwood NSW 2122",
  );
});

test("getStoreLabelSettingService returns label name and formatted address", async () => {
  const service = createGetStoreLabelSettingService({
    storeSetting: {
      findUnique: async () => ({
        name: "DREAM MARKET",
        address1: "42-50 Rowe St.",
        address2: null,
        suburb: "Eastwood",
        state: "NSW",
        postcode: "2122",
      }),
    },
  });

  const result = await service();

  assert.deepEqual(result, {
    ok: true,
    result: {
      name: "DREAM MARKET",
      address: "42-50 Rowe St. Eastwood NSW 2122",
    },
    msg: "Store label setting retrieved successfully",
  });
});

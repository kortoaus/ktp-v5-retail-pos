// npm run test:orders (T-24 audit R-10 — renderer idle predicate)
import assert from "node:assert/strict";
import test from "node:test";

import { isTillIdle } from "./till-idle.ts";
import { checkoutsInFlight, trackCheckout } from "../libs/checkout-inflight.ts";

const empty = () => ({ lines: [] });
const withRow = () => ({ lines: [{ lineKey: "a" }] });

test("idle = every open sale empty and nothing in flight", () => {
  assert.equal(isTillIdle([empty(), empty(), empty(), empty()], 0), true);
});

test("a row on ANY open sale (not just the active cart) is busy", () => {
  assert.equal(isTillIdle([empty(), empty(), withRow(), empty()], 0), false);
});

test("a checkout/refund in flight is busy even with empty carts", () => {
  assert.equal(isTillIdle([empty()], 1), false);
});

test("trackCheckout counts a request until it settles (ok or failed)", async () => {
  let release;
  const p = trackCheckout(new Promise((r) => (release = r)));
  assert.equal(checkoutsInFlight(), 1);
  release({ ok: true });
  await p;
  assert.equal(checkoutsInFlight(), 0);
  await assert.rejects(trackCheckout(Promise.reject(new Error("net"))));
  assert.equal(checkoutsInFlight(), 0);
});

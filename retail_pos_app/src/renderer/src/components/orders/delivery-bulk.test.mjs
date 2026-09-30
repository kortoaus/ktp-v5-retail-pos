// npm run test:orders
import assert from "node:assert/strict";
import test from "node:test";

import {
  BULK_CHUNK_SIZE,
  bulkTargets,
  chunk,
  describeTransitionFailure,
  dispatchConfirmText,
  paymentFailureMessage,
  runDeliveryBulk,
  scheduleConfirmText,
  selectableIds,
  sumTotals,
  todaySummaryText,
  tomorrowSummaryText,
} from "./delivery-bulk.ts";

const row = (id, status, total = 1000, fulfillment = "DELIVERY") => ({ id, status, total, fulfillment, version: id * 10 });

test("schedule targets = selected ACCEPTED delivery rows in list order", () => {
  const rows = [row(1, "ACCEPTED"), row(2, "SCHEDULED"), row(3, "ACCEPTED"), row(4, "ACCEPTED", 1, "CLICK_AND_COLLECT")];
  assert.deepEqual(bulkTargets(rows, new Set([3, 2, 1, 4]), "schedule").map((r) => r.id), [1, 3]);
  assert.deepEqual(bulkTargets(rows, new Set([2, 3]), "dispatch").map((r) => r.id), [2]);
  assert.deepEqual(selectableIds(rows, "schedule"), [1, 3]);
  assert.deepEqual(selectableIds(rows, "dispatch"), [2]);
});

test("confirm dialogs: schedule shows count + AUD total, dispatch count only", () => {
  const rows = [row(1, "ACCEPTED", 84220), row(2, "ACCEPTED", 39230)];
  assert.equal(sumTotals(rows), 123450);
  assert.deepEqual(scheduleConfirmText(9, 123450), {
    title: "Charge 9 cards now?",
    lines: ["Total $1,234.50 (AUD)", "Customers are charged and told their delivery day."],
    confirmLabel: "Charge 9 orders",
  });
  assert.equal(scheduleConfirmText(1, 500).title, "Charge 1 card now?");
  assert.deepEqual(dispatchConfirmText(9), {
    title: "Dispatch 9 orders?",
    lines: ['Customers are told "Arriving today".'],
    confirmLabel: "Dispatch 9 orders",
  });
});

test("work bar summaries", () => {
  const rows = [row(1, "ACCEPTED"), row(2, "SCHEDULED"), row(3, "SCHEDULED")];
  assert.equal(tomorrowSummaryText("Fri 25 Sep", rows), "Fri 25 Sep · 3 orders · 1 to schedule · 2 scheduled");
  assert.equal(todaySummaryText(rows), "Today · 3 orders · 1 not scheduled · 2 to dispatch");
});

test("chunk splits into 10s", () => {
  assert.equal(BULK_CHUNK_SIZE, 10);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("payment and transition failure copy", () => {
  assert.match(paymentFailureMessage("PAYMENT_CAPTURE_FAILED", { reason: "AUTH_EXPIRED" }), /Card hold expired/);
  assert.match(paymentFailureMessage("PAYMENT_CAPTURE_FAILED", "card_declined"), /\(card_declined\)/);
  assert.equal(paymentFailureMessage("OTHER", null), null);
  assert.match(describeTransitionFailure("TRANSITION_CONFLICT"), /updated elsewhere/);
  assert.equal(describeTransitionFailure("WEIRD", "x"), "WEIRD (x)");
});

test("runDeliveryBulk: sequential 10-chunks, per-row results, failed chunk marks every row", async () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, version: 1 }));
  const calls = [];
  const progress = [];
  const results = await runDeliveryBulk(
    "schedule",
    rows,
    async (kind, orders) => {
      calls.push(orders.map((o) => o.id));
      if (orders[0].id === 11) return { ok: false, msg: "Network Error", result: null };
      return {
        ok: true,
        msg: "",
        result: {
          results: orders.map((o) =>
            o.id === 2
              ? { id: o.id, ok: false, code: "PAYMENT_CAPTURE_FAILED", detail: "AUTH_EXPIRED" }
              : { id: o.id, ok: true, status: "SCHEDULED", version: 2 },
          ),
        },
      };
    },
    (done, total) => progress.push(`${done}/${total}`),
  );
  assert.deepEqual(calls.map((c) => c.length), [10, 10, 3]);
  assert.deepEqual(progress, ["10/23", "20/23", "23/23"]);
  assert.equal(results.size, 23);
  assert.deepEqual(results.get(1), { ok: true, label: "Scheduled", status: "SCHEDULED", version: 2 });
  assert.match(results.get(2).message, /Card hold expired/);
  assert.equal(results.get(15).ok, false);
  assert.match(results.get(15).message, /Network Error — refresh/);
});

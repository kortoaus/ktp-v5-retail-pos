// npm run test:orders
import assert from "node:assert/strict";
import test from "node:test";

import {
  chipsForLevel1,
  formatClock12,
  formatDayLabel,
  formatDeliveryDay,
  formatDueColumn,
  formatMoney,
  formatPrintedAt,
  goneLabelForStatus,
  hasOpenRefundRequest,
  isBucketEchoMissing,
  issueChipsForRow,
  level1Counts,
  level1Tone,
  lineSummaryText,
  listQueryForView,
  rowStripTone,
  viewFromBucketParam,
} from "./triage-format.ts";

const BUCKETS = {
  asOf: "2026-09-24T05:00:00.000Z",
  today: "2026-09-24",
  nextDeliveryDate: "2026-09-26",
  deliveryWindow: { startMinutes: 540, endMinutes: 1260 },
  counts: {
    new: { total: 3, pickup: 2, delivery: 1 },
    issues: {
      total: 2,
      byKind: {
        ACCEPT_OVERDUE: 1,
        NOT_SCHEDULED: 0,
        PAYMENT_FAILED: 0,
        AUTO_VOID_SOON: 0,
        PICKUP_NOT_READY: 1,
        NOT_COLLECTED: 0,
        DELIVERY_LATE: 0,
      },
    },
    pickup: { today: 4, ready: 3, upcoming: 6 },
    delivery: { today: 2, out: 1, tomorrow: 5, upcoming: 9, tomorrowToSchedule: 3, tomorrowScheduled: 2 },
  },
};

test("default entry is New; ?bucket= maps to level-1 + chip", () => {
  assert.deepEqual(viewFromBucketParam(null), { level1: "new", chip: "all" });
  assert.deepEqual(viewFromBucketParam("bogus"), { level1: "new", chip: "all" });
  assert.deepEqual(viewFromBucketParam("new"), { level1: "new", chip: "all" });
  assert.deepEqual(viewFromBucketParam("issues"), { level1: "issues", chip: "all" });
  assert.deepEqual(viewFromBucketParam("pickup.ready"), { level1: "pickup", chip: "pickup.ready" });
  assert.deepEqual(viewFromBucketParam("delivery.tomorrow"), { level1: "delivery", chip: "delivery.tomorrow" });
});

test("list query: bucket + fulfillment/issue + one page of 100", () => {
  assert.equal(listQueryForView({ level1: "new", chip: "all" }), "?bucket=new&page=1&limit=100");
  assert.equal(
    listQueryForView({ level1: "new", chip: "DELIVERY" }),
    "?bucket=new&fulfillment=DELIVERY&page=1&limit=100",
  );
  assert.equal(
    listQueryForView({ level1: "issues", chip: "NOT_COLLECTED" }),
    "?bucket=issues&issue=NOT_COLLECTED&page=1&limit=100",
  );
  assert.equal(
    listQueryForView({ level1: "delivery", chip: "delivery.out" }),
    "?bucket=delivery.out&page=1&limit=100",
  );
});

test("old crm is detected by a missing/different paging.bucket echo", () => {
  const paging = { currentPage: 1, totalPages: 1, hasPrev: false, hasNext: false };
  assert.equal(isBucketEchoMissing(paging, "new"), true);
  assert.equal(isBucketEchoMissing({ ...paging, bucket: "new" }, "new"), false);
  assert.equal(isBucketEchoMissing({ ...paging, bucket: "new" }, "issues"), true);
  assert.equal(isBucketEchoMissing(null, "new"), true);
});

test("level-1 counts: pickup/delivery sum level-2 without Upcoming; null without buckets", () => {
  assert.deepEqual(level1Counts(BUCKETS), { new: 3, pickup: 7, delivery: 8, issues: 2 });
  assert.deepEqual(level1Counts(null), { new: null, pickup: null, delivery: null, issues: null });
});

test("level-1 tone: New orange / Issues red only when > 0", () => {
  assert.equal(level1Tone("new", 3), "orange");
  assert.equal(level1Tone("new", 0), "gray");
  assert.equal(level1Tone("issues", 1), "red");
  assert.equal(level1Tone("issues", null), "gray");
  assert.equal(level1Tone("pickup", 7), "gray");
});

test("level-2 chips: delivery Next uses the next delivery day", () => {
  const delivery = chipsForLevel1("delivery", BUCKETS, "delivery.today");
  assert.deepEqual(
    delivery.map((c) => [c.key, c.label, c.count]),
    [
      ["delivery.today", "Today", 2],
      ["delivery.out", "Out", 1],
      ["delivery.tomorrow", "Next: Sat 26 Sep", 5],
      ["delivery.upcoming", "Upcoming", 9],
    ],
  );
  const pickup = chipsForLevel1("pickup", BUCKETS, "pickup.today");
  assert.deepEqual(pickup.map((c) => c.label), ["Today", "Ready", "Upcoming"]);
  const fresh = chipsForLevel1("new", BUCKETS, "all");
  assert.deepEqual(fresh.map((c) => [c.key, c.count]), [["all", 3], ["CLICK_AND_COLLECT", 2], ["DELIVERY", 1]]);
});

test("issues chips: All + kinds with count > 0, keeping the selected kind at 0", () => {
  assert.deepEqual(
    chipsForLevel1("issues", BUCKETS, "all").map((c) => c.key),
    ["all", "ACCEPT_OVERDUE", "PICKUP_NOT_READY"],
  );
  assert.deepEqual(
    chipsForLevel1("issues", BUCKETS, "DELIVERY_LATE").map((c) => c.key),
    ["all", "ACCEPT_OVERDUE", "PICKUP_NOT_READY", "DELIVERY_LATE"],
  );
});

test("date labels come from the date string itself (no tz shift)", () => {
  assert.equal(formatDayLabel("2026-09-24"), "Thu 24 Sep");
  assert.equal(formatDayLabel("2026-09-29"), "Tue 29 Sep");
  assert.equal(formatDayLabel("junk"), "junk");
});

test("clock and delivery day window", () => {
  assert.equal(formatClock12(540), "9am");
  assert.equal(formatClock12(1260), "9pm");
  assert.equal(formatClock12(750), "12:30pm");
  assert.equal(formatClock12(0), "12am");
  assert.equal(
    formatDeliveryDay("2026-09-26", { startMinutes: 540, endMinutes: 1260 }),
    "Sat 26 Sep · 9am–9pm",
  );
  assert.equal(formatDeliveryDay("2026-09-26", { startMinutes: null, endMinutes: 1260 }), "Sat 26 Sep");
  assert.equal(formatDeliveryDay(null, null), "—");
});

test("due column: C&C slot (+date when not today), delivery Today / D Mon, never 00:00", () => {
  const cnc = { fulfillment: "CLICK_AND_COLLECT", pickupDate: "2026-09-24", pickupSlotMinutes: 630, deliveryEtaDate: null };
  assert.equal(formatDueColumn(cnc, "2026-09-24"), "10:30");
  assert.equal(formatDueColumn({ ...cnc, pickupDate: "2026-09-25" }, "2026-09-24"), "25 Sep 10:30");
  const dlv = { fulfillment: "DELIVERY", pickupDate: null, pickupSlotMinutes: null, deliveryEtaDate: "2026-09-24" };
  assert.equal(formatDueColumn(dlv, "2026-09-24"), "Today");
  assert.equal(formatDueColumn({ ...dlv, deliveryEtaDate: "2026-09-26" }, "2026-09-24"), "26 Sep");
  assert.equal(formatDueColumn({ ...dlv, deliveryEtaDate: null }, "2026-09-24"), "—");
});

test("printed-at is Sydney D/M/Y h:mm am/pm", () => {
  assert.equal(formatPrintedAt(new Date("2026-09-24T05:42:00Z")), "24/09/2026 3:42pm");
  assert.equal(formatPrintedAt(new Date("2026-09-23T23:05:00Z")), "24/09/2026 9:05am");
  // DST (AEDT, UTC+11) from 4 Oct 2026
  assert.equal(formatPrintedAt(new Date("2026-10-05T01:00:00Z")), "05/10/2026 12:00pm");
});

test("money with thousands separators", () => {
  assert.equal(formatMoney(123450), "$1,234.50");
  assert.equal(formatMoney(5), "$0.05");
  assert.equal(formatMoney(100000000), "$1,000,000.00");
});

test("issue chips: server text, max 2 + more", () => {
  assert.deepEqual(issueChipsForRow(undefined), { shown: [], more: 0 });
  assert.deepEqual(
    issueChipsForRow({ bucket: "new", issues: ["ACCEPT_OVERDUE", "PAYMENT_FAILED", "AUTO_VOID_SOON"], issueText: ["a", "b", "c"] }),
    { shown: ["a", "b"], more: 1 },
  );
});

test("row strip: red for any issue, amber when only auto-void-soon", () => {
  assert.equal(rowStripTone(undefined), null);
  assert.equal(rowStripTone({ bucket: "new", issues: [], issueText: [] }), null);
  assert.equal(rowStripTone({ bucket: "new", issues: ["AUTO_VOID_SOON"], issueText: ["x"] }), "amber");
  assert.equal(
    rowStripTone({ bucket: "new", issues: ["AUTO_VOID_SOON", "ACCEPT_OVERDUE"], issueText: ["x", "y"] }),
    "red",
  );
});

test("Refund requested info badge: openRefundRequest, falling back to refundDue on old crm", () => {
  assert.equal(hasOpenRefundRequest({ state: "CAPTURED", refundDue: true, lastError: null, openRefundRequest: { count: 1, amount: 100 } }), true);
  assert.equal(hasOpenRefundRequest({ state: "CAPTURED", refundDue: false, lastError: null, openRefundRequest: null }), false);
  assert.equal(hasOpenRefundRequest({ state: "CAPTURED", refundDue: true, lastError: null }), true);
  assert.equal(hasOpenRefundRequest({ state: "CAPTURED", refundDue: false, lastError: null }), false);
});

test("line summary and gone labels", () => {
  assert.equal(lineSummaryText({ lineCount: 3, firstLineNameEn: "Brisket", firstLineNameKo: null }), "Brisket +2");
  assert.equal(lineSummaryText({ lineCount: 1, firstLineNameEn: " ", firstLineNameKo: "김밥" }), "김밥");
  assert.equal(goneLabelForStatus("READY"), "→ Ready");
  assert.equal(goneLabelForStatus("COLLECTED"), "Collected");
  assert.equal(goneLabelForStatus(undefined), "Moved by another till");
});

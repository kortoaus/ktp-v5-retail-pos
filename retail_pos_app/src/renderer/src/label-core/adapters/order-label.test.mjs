// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_LINE_UOM,
  formatOrderLabelDue,
  toOrderLabelInput,
} from "./order-label.ts";
import { buildOrderLabel100100 } from "../templates/order-100100.ts";
import { renderLabel } from "../zpl.ts";

const DETAIL = {
  id: 4821,
  orderNo: "ORD-260827-0012",
  dueAt: "2026-08-27T04:00:00.000Z", // 27/08 14:00 Sydney (AEST, +10)
};

const LINE = {
  id: 91,
  sourceItemId: 3466,
  name_en: "Assorted Sashimi Platter",
  name_ko: "모듬사시미",
  qty: 2,
  options: [
    { groupName_en: "Wasabi", optionName_en: "Extra", qty: 1 },
    { groupName_en: "", optionName_en: "No Ginger", qty: 1 },
  ],
};

// ── due text ───────────────────────────────────────────────────────────────

test("formatOrderLabelDue renders the server's dueAt in Sydney time", () => {
  assert.equal(formatOrderLabelDue(DETAIL.dueAt), "Thu 27th Aug 14:00");
});

test("formatOrderLabelDue returns null for a missing or unusable dueAt", () => {
  assert.equal(formatOrderLabelDue(null), null);
  assert.equal(formatOrderLabelDue(""), null);
  assert.equal(formatOrderLabelDue("not a date"), null);
});

// ── the adapter ────────────────────────────────────────────────────────────

test("toOrderLabelInput maps a made-to-order line", () => {
  assert.deepEqual(toOrderLabelInput(DETAIL, LINE), {
    orderNo: "ORD-260827-0012",
    dueText: "Thu 27th Aug 14:00",
    nameKo: "모듬사시미",
    nameEn: "Assorted Sashimi Platter",
    qty: 2,
    uom: ORDER_LINE_UOM,
    // groupName is dropped when blank — formatOrderLabelOptionLine's rule.
    optionLines: ["Wasabi: Extra x1", "No Ginger x1"],
    orderQrData: "order%%%4821",
    ppQrData: null,
  });
});

test("an unnamed line falls back to its source item id", () => {
  const input = toOrderLabelInput(DETAIL, { ...LINE, name_en: "   " });
  assert.equal(input.nameEn, "#3466");
});

test("a line with no options carries an empty list, not a placeholder", () => {
  const input = toOrderLabelInput(DETAIL, { ...LINE, options: [] });
  assert.deepEqual(input.optionLines, []);
});

// ── end to end ─────────────────────────────────────────────────────────────

test("the label renders with a real order QR and no PP box", () => {
  const zpl = renderLabel(buildOrderLabel100100(toOrderLabelInput(DETAIL, LINE)));

  assert.match(zpl, /^\^XA\n\^CI28\n/);
  assert.ok(zpl.includes("^PW800"), "100 mm at 8 dots/mm, not the old 812");
  assert.ok(zpl.includes("^LL800"));
  assert.ok(zpl.includes("모듬사시미"), "the hangul name the old builder dropped");
  assert.ok(zpl.includes("order%%%4821"), "a real payload, not an empty box");
  assert.ok(zpl.includes("2 EA / Thu 27th Aug 14:00"), "quantity and due on one line");
  assert.ok(zpl.includes("ORD-260827-0012"));
  assert.equal(zpl.match(/\^BQ/g).length, 1, "exactly one QR — there is no PP payload");
  assert.ok(!zpl.includes("PP"), "and no PP caption");
});

test("a missing dueAt prints a dash rather than dropping the deadline", () => {
  const zpl = renderLabel(
    buildOrderLabel100100(toOrderLabelInput({ ...DETAIL, dueAt: null }, LINE)),
  );
  assert.ok(zpl.includes("2 EA / -"));
});

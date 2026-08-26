// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrderLabel100100,
  fitOptionLines,
  orderQtyLine,
  qrMagForBox,
  wrapChars,
} from "./order-100100.ts";
import { MEDIA } from "../media.ts";
import { estimateQrSize, textWidth, utf8Length } from "../measure.ts";
import { elementBounds, renderLabel } from "../zpl.ts";

const SAMPLE = {
  orderNo: "SASH-0412",
  // moment `ddd Do MMM HH:mm` — the format the JSDoc names and the callers use.
  dueText: "Thu 27th Aug 14:00",
  nameKo: "모듬사시미 (테스트)",
  nameEn: "Assorted Sashimi Platter",
  qty: 2,
  uom: "ea",
  optionLines: ["Wasabi: Extra x1", "Soy Sauce: Low sodium x2", "Cut: Thick x1"],
  // The real payloads, because the whole point of the per-payload magnification
  // below is that these two are nowhere near the same length: 11 bytes against
  // 124.
  orderQrData: "order%%%412",
  ppQrData:
    '00:{"00":2,"01":"9300001","02":[6200,6200,6200,6200,6200],' +
    '"03":[5500,5500,5500,5500,5500],"04":512,"07":"2026-08-26","08":1}',
};

/** The box interior the template packs a symbol into: 220 box, 3 border, 3 quiet. */
const BOX = 220;
const BOX_Y = 556;
const QR_PAD = 6;
const QR_BOTTOM_Y = BOX_Y + BOX - QR_PAD;
const QR_TOP_LIMIT = BOX_Y + 6 + 24 + 4;

function qrElements(input = SAMPLE) {
  return buildOrderLabel100100(input).elements.filter((el) => el.kind === "qr");
}

test("the label is 800 × 800 and both symbol boxes carry a real QR", () => {
  const zpl = renderLabel(buildOrderLabel100100(SAMPLE));

  assert.ok(zpl.includes("^PW800") && zpl.includes("^LL800"));
  assert.ok(zpl.includes("^FO24,556^GB220,220,3^FS"), "left box");
  assert.ok(zpl.includes("^FO556,556^GB220,220,3^FS"), "right box");
  assert.equal(zpl.split("^BQN,2,").length - 1, 2, "two QR symbols");
  assert.ok(zpl.includes(`^FDLA,${SAMPLE.orderQrData}^FS`));
  assert.ok(zpl.includes(`^FDLA,${SAMPLE.ppQrData}^FS`));
});

test("both symbols are ^FT (bottom-anchored), never ^FO", () => {
  const zpl = renderLabel(buildOrderLabel100100(SAMPLE));

  // ^FO would let the printed top edge drift with the payload length — see
  // QrAnchor in ../model. The anchor sits at the box's bottom-left inside pad.
  assert.equal(zpl.split("^FT").length - 1, 2, "two ^FT anchors, one per symbol");
  assert.ok(!/\^FO\d+,\d+\^BQ/.test(zpl), "no ^FO-anchored QR");
  assert.ok(zpl.includes(`^FT${24 + QR_PAD},${QR_BOTTOM_Y}^BQN,2,`), "left anchor");
  assert.ok(zpl.includes(`^FT${556 + QR_PAD},${QR_BOTTOM_Y}^BQN,2,`), "right anchor");

  for (const el of qrElements()) {
    assert.equal(el.anchor, "bottom");
    assert.equal(el.y, QR_BOTTOM_Y);
  }
});

test("magnification is per payload — an 11-byte order QR is not a 124-byte PP QR", () => {
  const [order, pp] = qrElements();

  assert.equal(order.data, SAMPLE.orderQrData);
  assert.equal(pp.data, SAMPLE.ppQrData);
  assert.ok(
    order.mag > pp.mag,
    `the short payload should print larger modules: order ${order.mag}, pp ${pp.mag}`,
  );
  for (const el of qrElements()) {
    assert.ok(el.mag >= 2 && el.mag <= 10, `mag ${el.mag} out of the 2..10 clamp`);
  }
});

test("each estimated symbol fits its 220-dot box, under the caption", () => {
  for (const el of qrElements()) {
    const side = estimateQrSize(el.mag, utf8Length(el.data));
    const box = elementBounds(el);

    assert.equal(box.h, side);
    assert.ok(side <= BOX - QR_PAD * 2, `side ${side} wider than the box interior`);
    assert.ok(box.y >= QR_TOP_LIMIT, `top ${box.y} collides with the caption`);
    assert.ok(box.y + box.h <= BOX_Y + BOX - QR_PAD, `bottom ${box.y + box.h} past the box`);
    assert.ok(box.x + box.w <= (el.x < 400 ? 24 : 556) + BOX - QR_PAD, "right edge inside");

    // ...and it is the largest such magnification: one step up would not fit.
    const bigger = estimateQrSize(el.mag + 1, utf8Length(el.data));
    assert.ok(
      el.mag === 10 || bigger > BOX - QR_PAD * 2 || bigger > QR_BOTTOM_Y - QR_TOP_LIMIT,
      `mag ${el.mag} left room for ${el.mag + 1}`,
    );
  }
});

test("magnification stays inside 2..10 whatever the payload", () => {
  // Nothing fits a 40-dot hole; floor at 2 rather than emitting mag 1 or throwing.
  assert.equal(qrMagForBox("x".repeat(400), 40, 40), 2);
  assert.equal(qrMagForBox("x", 4000, 4000), 10, "and the top of the clamp holds");
});

test("no PP payload, no PP box — an empty 220-dot square prints nothing usefully", () => {
  const zpl = renderLabel(buildOrderLabel100100({ ...SAMPLE, ppQrData: null }));

  assert.ok(zpl.includes("^FO24,556^GB220,220,3^FS"), "the order box stays");
  assert.ok(!zpl.includes("^FO556,556^GB220,220,3^FS"), "the PP box is gone");
  assert.equal(zpl.split("^BQN,2,").length - 1, 1);
});

test("the Korean name prints — it used to be dropped for not being ASCII", () => {
  const zpl = renderLabel(buildOrderLabel100100(SAMPLE));
  assert.ok(zpl.includes("^FD모듬사시미 (테스트)^FS"), zpl);
  const koLine = zpl.split("\n").find((line) => line.includes("모듬사시미"));
  assert.match(koLine, /E:NOTOKRB\.TTF/, "Bold, and a real font");
});

/** The quantity/due line: the one black (`BK`) text element on the label. */
function qtyElement(input = SAMPLE) {
  const el = buildOrderLabel100100(input).elements.find(
    (e) => e.kind === "text" && e.weight === "BK",
  );
  assert.ok(el, "a black quantity line");
  return el;
}

test("quantity and due are one line — the two numbers someone packing needs", () => {
  const zpl = renderLabel(buildOrderLabel100100(SAMPLE));

  assert.equal(orderQtyLine(2, "ea", "Thu 27th Aug 14:00"), "2 EA / Thu 27th Aug 14:00");
  assert.equal(qtyElement().text, "2 EA / Thu 27th Aug 14:00");
  assert.ok(zpl.includes("^FD2 EA / Thu 27th Aug 14:00^FS"), zpl);

  // Same place on the label as the old `QTY 2`: y is derived from the box top
  // and the asked size, not from whatever the fit came back with.
  assert.equal(qtyElement().y, 472);
  const qtyLine = zpl.split("\n").find((line) => line.includes(" / "));
  assert.match(qtyLine, /^\^FO24,472\^A@N,\d+,\d+,E:NOTOKRBK\.TTF\^FB752,1,0,L,0/, qtyLine);
});

test("no due text prints `-`, never a line that just stops", () => {
  assert.equal(orderQtyLine(2, "ea", null), "2 EA / -");
  assert.equal(orderQtyLine(2, "ea", "   "), "2 EA / -");

  for (const dueText of [null, undefined, "", "  "]) {
    const el = qtyElement({ ...SAMPLE, dueText });
    assert.equal(el.text, "2 EA / -", `dueText ${JSON.stringify(dueText)}`);
  }
  assert.ok(renderLabel(buildOrderLabel100100({ ...SAMPLE, dueText: null })).includes(
    "^FD2 EA / -^FS",
  ));
});

test("the line is asked for 68 and shrinks only as far as it must", () => {
  // Short enough to keep the full 68.
  assert.equal(qtyElement({ ...SAMPLE, qty: 1, uom: "ea", dueText: "1st Sep 26" }).size, 68);

  for (const input of [
    SAMPLE,
    { ...SAMPLE, qty: 1, uom: "ea", dueText: null },
    { ...SAMPLE, qty: 9999, uom: "packs", dueText: "Thu 27th Aug 14:00" },
  ]) {
    const el = qtyElement(input);
    assert.ok(el.size <= 68 && el.size >= 40, `size ${el.size} outside 40..68`);
    assert.ok(
      textWidth(el.text, el.size) <= 752,
      `"${el.text}" at ${el.size} measures ${textWidth(el.text, el.size)} > 752`,
    );
    assert.equal(el.lines, 1, "one line is the whole point of joining them");
    assert.equal(el.y, 472, "and it does not move when it shrinks");
  }

  // A line long enough to need it does end up smaller than 68 — the sample's
  // own `2 EA / Thu 27th Aug 14:00` already is.
  const long = qtyElement({ ...SAMPLE, qty: 9999, uom: "packs" });
  assert.ok(qtyElement().size < 68, `the sample should shrink, got ${qtyElement().size}`);
  assert.ok(long.size < qtyElement().size, `longer should be smaller: ${long.size}`);
});

test("40 is the floor — a clipped quantity beats an illegible one", () => {
  const el = qtyElement({
    ...SAMPLE,
    qty: 999999,
    uom: "individual retail cartons",
    dueText: "Wednesday the 30th of September 2026 at 14:30",
  });
  assert.equal(el.size, 40);
});

test("the footer between the boxes is the order number, centred, and nothing else", () => {
  const zpl = renderLabel(buildOrderLabel100100(SAMPLE));
  assert.ok(zpl.includes("^FDSASH-0412^FS"));
  assert.ok(!/\bDue\b/.test(zpl), `the redundant Due footer is gone:\n${zpl}`);

  const footer = buildOrderLabel100100(SAMPLE).elements.find(
    (el) => el.kind === "text" && el.text === "SASH-0412",
  );
  // Vertically centred in the 220-dot box band, 556..776.
  assert.equal(footer.y, BOX_Y + (BOX - 24) / 2);
  assert.equal(footer.y - BOX_Y, BOX_Y + BOX - (footer.y + 24), "equal air above and below");
  assert.equal(footer.align, "C");

  // Only one text element lives between the boxes now.
  const between = buildOrderLabel100100(SAMPLE).elements.filter(
    (el) => el.kind === "text" && el.x > 244 && el.x < 556,
  );
  assert.equal(between.length, 1, between.map((el) => el.text).join(" | "));
});

test("option overflow is announced, not silently dropped", () => {
  assert.deepEqual(fitOptionLines(["a", "b", "c"], 5), ["a", "b", "c"]);
  assert.deepEqual(fitOptionLines(["a", "b", "c", "d"], 3), ["a", "b", "+2 more"]);
  assert.deepEqual(fitOptionLines(["a", "b"], 1), ["+2 more"]);

  const many = buildOrderLabel100100({
    ...SAMPLE,
    optionLines: Array.from({ length: 30 }, (_, i) => `Option group ${i}: choice ${i} x1`),
  });
  const more = many.elements.find((el) => el.kind === "text" && /^\+\d+ more$/.test(el.text));
  assert.ok(more, "a +N more line");
  assert.ok(!many.elements.some((el) => el.kind === "text" && el.text.includes("Option group 29")));
});

test("a long option line wraps before it is counted", () => {
  assert.deepEqual(wrapChars("short", 42), ["short"]);
  const wrapped = wrapChars(
    "Sauce selection: extra hot chilli with garlic and spring onion x3",
    42,
  );
  assert.ok(wrapped.length > 1);
  assert.ok(wrapped.every((line) => line.length <= 42));
});

test("nothing lands outside 800 × 800", () => {
  const [pageW, pageH] = MEDIA["100100"].dots;
  const inputs = [
    SAMPLE,
    { ...SAMPLE, ppQrData: null, nameKo: "", optionLines: [] },
    {
      ...SAMPLE,
      nameEn: "Assorted Sashimi Platter Deluxe Family Size With Everything",
      optionLines: Array.from({ length: 30 }, (_, i) => `Option group ${i}: choice ${i} x1`),
      qty: 999,
    },
  ];
  for (const input of inputs) {
    for (const el of buildOrderLabel100100(input).elements) {
      const box = elementBounds(el);
      assert.ok(box.x >= 0 && box.y >= 0, `${el.kind} starts on the label`);
      assert.ok(box.x + box.w <= pageW, `${el.kind} right edge ${box.x + box.w} > ${pageW}`);
      assert.ok(box.y + box.h <= pageH, `${el.kind} bottom ${box.y + box.h} > ${pageH}`);
    }
  }
});

test("dbg rides through", () => {
  assert.equal(buildOrderLabel100100(SAMPLE, { dbg: true }).dbg, true);
});

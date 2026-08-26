// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { buildShippingLabel100100, layoutShippingName } from "./shipping-100100.ts";
import { MEDIA } from "../media.ts";
import { estimateQrSize, textWidth, utf8Length } from "../measure.ts";
import { elementBounds, renderLabel } from "../zpl.ts";

const MAPS_URL =
  "https://www.google.com/maps/dir/?api=1&destination=-33.7905,151.0815" +
  "&travelmode=driving&dir_action=navigate";

const SAMPLE = {
  documentId: "SO 24081",
  // Hangul on purpose: the legacy builder stripped it to spaces, and that is
  // the single behaviour this port exists to change.
  customerName: "드림마트 이스트우드 (Dream Mart Eastwood)",
  // moment `ddd Do MMM`, the format the JSDoc names and the callers use.
  deliveryDateText: "Thu 27th Aug",
  cycleText: "3",
  addressText: "Eastwood NSW 2122",
  // The scanner contract. Short — which is the whole reason the magnification
  // is computed per payload rather than shared with the ~110-byte maps URL.
  saleOrderQrData: "so%%%24081",
  mapsQrData: MAPS_URL,
};

/** The bottom edge both symbols are typeset from, and their logical square. */
const QR_BOX = 240;
const QR_BOTTOM_Y = 776;
const QR_LEFT_X = 24;
const QR_RIGHT_X = 536;
const QR_CAPTION_Y = 508;

const CONTENT_W = 752;

function build(input = SAMPLE) {
  return buildShippingLabel100100(input);
}

function texts(input = SAMPLE) {
  return build(input).elements.filter((el) => el.kind === "text");
}

function qrElements(input = SAMPLE) {
  return build(input).elements.filter((el) => el.kind === "qr");
}

function textAt(y, input = SAMPLE) {
  const el = texts(input).find((e) => e.y === y);
  assert.ok(el, `a text element at y ${y}`);
  return el;
}

test("the label is 800 × 800 and carries both symbols", () => {
  const zpl = renderLabel(build());

  assert.ok(zpl.includes("^PW800") && zpl.includes("^LL800"), zpl);
  assert.ok(zpl.includes("^LL800"));
  assert.ok(zpl.startsWith("^XA\n^CI28\n^PW800\n^LL800\n^LH0,0"), zpl);
  assert.equal(zpl.split("^BQN,2,").length - 1, 2, "two QR symbols");
  assert.ok(zpl.includes(`^FDLA,${SAMPLE.saleOrderQrData}^FS`), "the sale-order payload");

  // The maps URL reaches the model verbatim; the emitter escapes the one byte
  // ^FH reserves (`dir_action`'s underscore is the hex introducer) on its way
  // out. That escaping is the emitter's job, not a sanitiser's — see
  // ../escape.ts, and note that the legacy builder's `sanitizeZplText` would
  // have left the `_` alone and corrupted the payload.
  assert.equal(qrElements()[1].data, MAPS_URL, "the model carries the URL untouched");
  assert.ok(zpl.includes("^FDLA,https://www.google.com/maps/dir/?api=1"), zpl);
  assert.ok(zpl.includes("&dir_5Faction=navigate^FS"), "the `_` is hex-escaped, not dropped");
});

test("both symbols are ^FT (bottom-anchored) and both field data start LA,", () => {
  const zpl = renderLabel(build());

  // ^FO would let the printed top edge drift with the payload length, and these
  // two payloads differ by ~100 bytes. See QrAnchor in ../model.
  assert.equal(zpl.split("^FT").length - 1, 2, "two ^FT anchors, one per symbol");
  assert.ok(!/\^FO\d+,\d+\^BQ/.test(zpl), "no ^FO-anchored QR");
  assert.ok(zpl.includes(`^FT${QR_LEFT_X},${QR_BOTTOM_Y}^BQN,2,`), "left anchor");
  assert.ok(zpl.includes(`^FT${QR_RIGHT_X},${QR_BOTTOM_Y}^BQN,2,`), "right anchor");
  assert.equal(zpl.split("^FDLA,").length - 1, 2, "automatic input mode on both");

  for (const el of qrElements()) {
    assert.equal(el.anchor, "bottom");
    assert.equal(el.y, QR_BOTTOM_Y);
  }
});

test("magnification is per payload — 10 bytes is not 110 bytes", () => {
  const [scan, map] = qrElements();

  assert.equal(scan.data, SAMPLE.saleOrderQrData);
  assert.equal(map.data, MAPS_URL);
  assert.ok(
    scan.mag > map.mag,
    `the short payload should print larger modules: scan ${scan.mag}, map ${map.mag}`,
  );

  for (const el of qrElements()) {
    assert.ok(el.mag >= 2 && el.mag <= 10, `mag ${el.mag} outside the 2..10 clamp`);
    const side = estimateQrSize(el.mag, utf8Length(el.data));
    assert.ok(side <= QR_BOX, `side ${side} overflows the ${QR_BOX}-dot square`);
    // ...and it is the largest one that does: a step up would not fit.
    assert.ok(
      el.mag === 10 || estimateQrSize(el.mag + 1, utf8Length(el.data)) > QR_BOX,
      `mag ${el.mag} left room for ${el.mag + 1}`,
    );
  }
});

test("the captions sit above their symbols, left-aligned to the box", () => {
  const scan = textAt(QR_CAPTION_Y);
  assert.equal(scan.text, "SCAN");
  assert.equal(scan.x, QR_LEFT_X);
  assert.equal(scan.size, 22);
  assert.equal(scan.weight, "M");

  const map = texts().find((el) => el.text === "MAP");
  assert.ok(map, "a MAP caption");
  assert.equal(map.x, QR_RIGHT_X);
  assert.equal(map.y, QR_CAPTION_Y);

  // Above, not inside: the caption must not eat the symbol's height.
  for (const el of qrElements()) {
    const box = elementBounds(el);
    assert.ok(
      box.y >= QR_CAPTION_Y + 22,
      `symbol top ${box.y} collides with the caption band`,
    );
  }
});

test("the Korean customer name prints, in a real Noto face", () => {
  const zpl = renderLabel(build());

  // The legacy sanitiser turned this into spaces, then into `NO CUSTOMER`.
  assert.ok(zpl.includes("드림마트 이스트우드 (Dream Mart Eastwood)"), zpl);
  const line = zpl.split("\n").find((l) => l.includes("드림마트"));
  assert.match(line, /E:NOTOKRB\.TTF/, "Bold, and a downloaded TTF rather than ^A0");
  assert.match(line, /\^FB752,\d,0,L,0/, "set as a measured block");
});

test("the name wraps by measured width, up to two lines", () => {
  assert.deepEqual(layoutShippingName("Dream Mart"), { size: 44, lines: 1 });

  const two = layoutShippingName(SAMPLE.customerName);
  assert.equal(two.lines, 2, "hangul is full-width — this name does not fit one line");
  assert.ok(two.size <= 44 && two.size >= 26);

  // A name too long for two lines at 44 shrinks rather than spilling.
  const long = layoutShippingName(
    "드림마트 이스트우드 웨어하우스 (Dream Mart Eastwood Warehouse & Cold Store, Building C)",
  );
  assert.equal(long.lines, 2);
  assert.ok(long.size < 44, `expected a shrink, got ${long.size}`);
  assert.ok(long.size >= 26, "and never below the floor");

  // The floor holds: clipping beats illegible.
  assert.equal(layoutShippingName("가".repeat(200)).size, 26);
});

test("the Delivery / Cycle box has two columns and a divider", () => {
  const zpl = renderLabel(build());

  assert.ok(zpl.includes("^FO24,210^GB752,150,3^FS"), "the box");
  assert.ok(zpl.includes("^FO400,210^GB3,150,3^FS"), "the vertical divider");
  assert.ok(zpl.includes("^FDDelivery^FS") && zpl.includes("^FDCycle^FS"));
  assert.ok(zpl.includes("^FDThu 27th Aug^FS") && zpl.includes("^FD3^FS"));

  const delivery = texts().find((el) => el.text === "Thu 27th Aug");
  const cycle = texts().find((el) => el.text === "3");
  for (const el of [delivery, cycle]) {
    assert.equal(el.weight, "BK", "the values are the black ones");
    assert.equal(el.y, 256);
    assert.equal(el.lines, 1);
    assert.ok(el.size <= 80 && el.size >= 40, `size ${el.size} outside 40..80`);
    assert.ok(textWidth(el.text, el.size) <= 344, `"${el.text}" overflows its column`);
  }
  assert.equal(cycle.size, 80, "a one-digit cycle keeps the full 80");
  assert.ok(delivery.x < 400, "delivery is the left column…");
  assert.ok(cycle.x >= 400, "…and cycle is the right one");
  assert.ok(texts().find((el) => el.text === "Delivery").x === delivery.x, "caption over value");
  assert.ok(texts().find((el) => el.text === "Cycle").x === cycle.x);

  // The longest `ddd Do MMM` the format can produce still shrinks to fit.
  const dateEl = (text) =>
    buildShippingLabel100100({ ...SAMPLE, deliveryDateText: text }).elements.find(
      (el) => el.kind === "text" && el.text === text,
    );

  const wide = dateEl("Wed 30th Sept");
  assert.ok(wide.size < 80, `expected a shrink, got ${wide.size}`);
  assert.ok(textWidth(wide.text, wide.size) <= 344, "and it fits the column");

  // Past the format, 40 is the floor and ^FB344,1 clips rather than spilling —
  // the same trade the document id and the name band make. What matters is that
  // the block width still declares the column, so nothing crosses the divider.
  const overlong = dateEl("Wednesday the 30th of September");
  assert.equal(overlong.size, 40);
  assert.equal(overlong.width, 344);
  assert.equal(elementBounds(overlong).x + elementBounds(overlong).w, 384);
});

test("the address is one line, no street — suburb, state, postcode", () => {
  const el = textAt(380);
  assert.equal(el.text, "Eastwood NSW 2122");
  assert.equal(el.lines, 1);
  assert.equal(el.weight, "M");
  assert.ok(el.size <= 40 && el.size >= 28);

  const long = buildShippingLabel100100({
    ...SAMPLE,
    addressText: "Wentworth Point Sydney Olympic Park NSW 2127",
  }).elements.find((e) => e.kind === "text" && e.y === 380);
  assert.ok(long.size <= 40 && long.size >= 28, `size ${long.size} outside 28..40`);
});

test("no maps URL, no right symbol and no MAP caption", () => {
  for (const mapsQrData of [null, undefined, ""]) {
    const label = buildShippingLabel100100({ ...SAMPLE, mapsQrData });
    const zpl = renderLabel(label);

    assert.equal(zpl.split("^BQN,2,").length - 1, 1, `mapsQrData ${JSON.stringify(mapsQrData)}`);
    assert.ok(zpl.includes(`^FDLA,${SAMPLE.saleOrderQrData}^FS`), "the sale-order QR stays");
    assert.ok(zpl.includes("^FDSCAN^FS"), "and so does its caption");
    assert.ok(!zpl.includes("^FDMAP^FS"), "the MAP caption is gone with its symbol");
    assert.equal(label.elements.filter((el) => el.kind === "qr").length, 1);
  }
});

test("blank fields print `-`, never a gap that reads as an error", () => {
  const bare = buildShippingLabel100100({
    ...SAMPLE,
    customerName: "   ",
    deliveryDateText: null,
    cycleText: null,
    addressText: "",
  });
  const zpl = renderLabel(bare);
  const dashes = bare.elements.filter((el) => el.kind === "text" && el.text === "-");

  assert.equal(dashes.length, 4, "customer, delivery, cycle and address");
  assert.equal(zpl.split("^FD-^FS").length - 1, 4);
  // The document id and both captions are untouched by the fallbacks.
  assert.ok(zpl.includes("^FDSO 24081^FS"));
  assert.ok(zpl.includes("^FDDelivery^FS") && zpl.includes("^FDCycle^FS"));

  for (const dueText of [undefined, ""]) {
    const el = buildShippingLabel100100({ ...SAMPLE, deliveryDateText: dueText }).elements.find(
      (e) => e.kind === "text" && e.y === 256 && e.x < 400,
    );
    assert.equal(el.text, "-", `deliveryDateText ${JSON.stringify(dueText)}`);
  }
});

test("the document id is asked for 72 and shrinks only as far as it must", () => {
  assert.equal(textAt(24).text, "SO 24081");
  assert.equal(textAt(24).size, 72);
  assert.equal(textAt(24).weight, "B");
  assert.equal(textAt(24).lines, 1);

  const long = textAt(24, { ...SAMPLE, documentId: "SO 24081-REPLACEMENT-B" });
  assert.ok(long.size < 72, `expected a shrink, got ${long.size}`);
  assert.ok(long.size >= 48, "and never below the 48 floor");
  assert.ok(textWidth(long.text, long.size) <= CONTENT_W);

  // 48 is the floor — a clipped id beats one nobody can read across a dock.
  assert.equal(textAt(24, { ...SAMPLE, documentId: "SO ".repeat(30) }).size, 48);
});

test("nothing lands outside 800 × 800", () => {
  const [pageW, pageH] = MEDIA["100100"].dots;
  const inputs = [
    SAMPLE,
    { ...SAMPLE, mapsQrData: null },
    { ...SAMPLE, customerName: "", deliveryDateText: null, cycleText: null, addressText: "" },
    {
      ...SAMPLE,
      documentId: "SO 24081 / RESHIP 000000002",
      customerName:
        "드림마트 이스트우드 웨어하우스 (Dream Mart Eastwood Warehouse & Cold Store, Building C)",
      deliveryDateText: "Wednesday 30th September",
      cycleText: "12 (AM)",
      addressText: "Wentworth Point Sydney Olympic Park NSW 2127",
      saleOrderQrData: "so%%%999999999",
      mapsQrData: `${MAPS_URL}&waypoints=-33.8688,151.2093|-33.8136,151.0034`,
    },
  ];

  for (const input of inputs) {
    for (const el of buildShippingLabel100100(input).elements) {
      const box = elementBounds(el);
      assert.ok(box.x >= 0 && box.y >= 0, `${el.kind} starts on the label`);
      assert.ok(box.x + box.w <= pageW, `${el.kind} right edge ${box.x + box.w} > ${pageW}`);
      assert.ok(box.y + box.h <= pageH, `${el.kind} bottom ${box.y + box.h} > ${pageH}`);
    }
  }
});

test("nothing overlaps: each band clears the one under it", () => {
  const label = build();
  const bounds = (pred) => elementBounds(label.elements.find(pred));

  const doc = bounds((el) => el.kind === "text" && el.y === 24);
  const name = bounds((el) => el.kind === "text" && el.text === SAMPLE.customerName);
  const box = bounds((el) => el.kind === "box");
  const addr = bounds((el) => el.kind === "text" && el.y === 380);
  const caption = bounds((el) => el.kind === "text" && el.text === "SCAN");

  assert.ok(doc.y + doc.h <= name.y, "document id clears the name");
  assert.ok(name.y + name.h <= box.y, "the name band clears the box");
  assert.ok(box.y + box.h <= addr.y, "the box clears the address");
  assert.ok(addr.y + addr.h <= caption.y, "the address clears the symbol captions");

  // The columns do not run into the divider.
  const divider = label.elements.find((el) => el.kind === "line");
  for (const el of label.elements.filter((e) => e.kind === "text" && e.y >= 210 && e.y < 360)) {
    const b = elementBounds(el);
    if (b.x < divider.x) assert.ok(b.x + b.w <= divider.x, `${el.text} crosses the divider`);
    else assert.ok(b.x >= divider.x + divider.w, `${el.text} sits on the divider`);
  }
});

test("dbg and copies ride through", () => {
  assert.equal(buildShippingLabel100100(SAMPLE, { dbg: true }).dbg, true);
  assert.equal(buildShippingLabel100100(SAMPLE).dbg, false);
  assert.equal(buildShippingLabel100100(SAMPLE, { copies: 3 }).copies, 3);
  assert.equal(buildShippingLabel100100(SAMPLE, { copies: 1 }).copies, undefined);
  assert.ok(renderLabel(buildShippingLabel100100(SAMPLE, { copies: 3 })).includes("^PQ3"));
});

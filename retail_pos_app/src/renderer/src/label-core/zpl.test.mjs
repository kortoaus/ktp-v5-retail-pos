// node --experimental-strip-types --test src/renderer/src/label-core/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { strike } from "./model.ts";
import { elementBounds, renderLabel, resolveTextSize } from "./zpl.ts";

/** Render one element on 6040 and return only the element's own lines. */
function emit(element, labelOpts = {}) {
  const zpl = renderLabel({ media: "6040", elements: [element], ...labelOpts });
  return zpl.split("\n");
}

function body(element, labelOpts = {}) {
  return emit(element, labelOpts).slice(5, -1);
}

test("the header pins encoding, media size and origin", () => {
  const lines = renderLabel({ media: "7030", elements: [] }).split("\n");
  assert.deepEqual(lines, ["^XA", "^CI28", "^PW560", "^LL240", "^LH0,0", "^XZ"]);
});

test("text emits ^A@ against the Noto object on E:", () => {
  assert.deepEqual(
    body({ kind: "text", x: 10, y: 20, text: "가나다 ABC", size: 30 }),
    ["^FO10,20^A@N,30,27,E:NOTOKRM.TTF^FH^FD가나다 ABC^FS"],
  );
});

test("text weight selects the matching font object", () => {
  const at = (weight) =>
    body({ kind: "text", x: 0, y: 0, text: "가", size: 20, weight })[0];
  assert.match(at("M"), /E:NOTOKRM\.TTF/);
  assert.match(at("B"), /E:NOTOKRB\.TTF/);
  assert.match(at("BK"), /E:NOTOKRBK\.TTF/);
});

test("the builtin font is ^A0N and carries no object name", () => {
  assert.deepEqual(
    body({ kind: "text", x: 4, y: 6, text: "ABC", size: 20, font: "builtin" }),
    ["^FO4,6^A0N,20,18^FH^FDABC^FS"],
  );
});

test("a width adds ^FB with lines and alignment", () => {
  assert.deepEqual(
    body({
      kind: "text",
      x: 0,
      y: 0,
      text: "가나다",
      size: 30,
      width: 300,
      lines: 2,
      align: "C",
    }),
    ["^FO0,0^A@N,30,27,E:NOTOKRM.TTF^FB300,2,0,C,0^FH^FD가나다^FS"],
  );
});

test("shrink resolves the size down before emitting", () => {
  const el = {
    kind: "text",
    x: 0,
    y: 0,
    text: "가나다라",
    size: 60,
    width: 100,
    shrink: true,
    minSize: 10,
  };
  assert.equal(resolveTextSize(el), 25); // 4 em into 100 dots
  assert.deepEqual(body(el), [
    "^FO0,0^A@N,25,23,E:NOTOKRM.TTF^FB100,1,0,L,0^FH^FD가나다라^FS",
  ]);
});

test("shrink without a width has nothing to fit into and is a no-op", () => {
  assert.equal(
    resolveTextSize({ kind: "text", x: 0, y: 0, text: "가나다라", size: 60, shrink: true }),
    60,
  );
});

test("field data is escaped and hangul is preserved", () => {
  assert.deepEqual(body({ kind: "text", x: 0, y: 0, text: "삼겹살 ^~_", size: 20 }), [
    "^FO0,0^A@N,20,18,E:NOTOKRM.TTF^FH^FD삼겹살 _5E_7E_5F^FS",
  ]);
});

test("line and box are both ^GB", () => {
  assert.deepEqual(body({ kind: "line", x: 5, y: 7, w: 200, h: 2, thick: 2 }), [
    "^FO5,7^GB200,2,2^FS",
  ]);
  assert.deepEqual(body({ kind: "box", x: 5, y: 7, w: 200, h: 90, thick: 3 }), [
    "^FO5,7^GB200,90,3^FS",
  ]);
  assert.deepEqual(body(strike(10, 40, 120)), ["^FO10,40^GB120,2,2^FS"]);
});

test("ean13 emits ^BY then ^BEN with the human-readable line", () => {
  assert.deepEqual(
    body({
      kind: "barcode",
      sym: "ean13",
      x: 12,
      y: 100,
      h: 80,
      module: 2,
      data: "930000000011",
    }),
    ["^FO12,100^BY2,3,80^BEN,80,Y,N^FH^FD930000000011^FS"],
  );
});

test("code128 emits ^BCN and can drop the human-readable line", () => {
  assert.deepEqual(
    body({
      kind: "barcode",
      sym: "code128",
      x: 0,
      y: 0,
      h: 60,
      module: 3,
      hri: false,
      data: "KTPV5-LBL",
    }),
    ["^FO0,0^BY3,3,60^BCN,60,N,N,N^FH^FDKTPV5-LBL^FS"],
  );
});

test("qr is model 2 and repeats the correction level in the field data", () => {
  assert.deepEqual(
    body({ kind: "qr", x: 40, y: 40, mag: 4, data: "https://ktpv5.local/x" }),
    ["^FO40,40^BQN,2,4,L^FH^FDLA,https://ktpv5.local/x^FS"],
  );
  assert.deepEqual(
    body({ kind: "qr", x: 0, y: 0, mag: 3, ec: "M", data: "가나" }),
    ["^FO0,0^BQN,2,3,M^FH^FDMA,가나^FS"],
  );
});

test("datamatrix is ^BXN at quality 200", () => {
  assert.deepEqual(
    body({ kind: "datamatrix", x: 8, y: 8, size: 6, data: "KTPV5-DM" }),
    ["^FO8,8^BXN,6,200^FH^FDKTPV5-DM^FS"],
  );
});

test("dbg adds a 1-dot outline after every element", () => {
  const lines = body(
    { kind: "text", x: 10, y: 20, text: "가나다", size: 30 },
    { dbg: true },
  );
  assert.deepEqual(lines, [
    "^FO10,20^A@N,30,27,E:NOTOKRM.TTF^FH^FD가나다^FS",
    "^FO10,20^GB90,30,1^FS",
  ]);
});

test("dbg outlines a barcode over its bars plus the HRI line", () => {
  const lines = body(
    { kind: "barcode", sym: "ean13", x: 0, y: 0, h: 80, module: 2, data: "930000000011" },
    { dbg: true },
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[1], "^FO0,0^GB190,110,1^FS");
});

test("dbg is off by default", () => {
  assert.equal(body({ kind: "line", x: 0, y: 0, w: 10, h: 2, thick: 2 }).length, 1);
});

test("copies emit ^PQ, and a single copy does not", () => {
  const withCopies = renderLabel({ media: "6040", elements: [], copies: 3 }).split("\n");
  assert.deepEqual(withCopies.slice(-2), ["^PQ3", "^XZ"]);

  for (const copies of [undefined, 1, 0]) {
    const zpl = renderLabel({ media: "6040", elements: [], copies });
    assert.equal(zpl.includes("^PQ"), false, `copies=${copies}`);
  }
});

test("elementBounds measures each kind", () => {
  assert.deepEqual(elementBounds({ kind: "text", x: 1, y: 2, text: "가나", size: 20, lines: 2 }), {
    x: 1,
    y: 2,
    w: 40,
    h: 40,
  });
  assert.deepEqual(elementBounds({ kind: "line", x: 0, y: 0, w: 100, h: 0, thick: 2 }), {
    x: 0,
    y: 0,
    w: 100,
    h: 2,
  });
  assert.deepEqual(elementBounds({ kind: "qr", x: 3, y: 4, mag: 2, data: "x" }), {
    x: 3,
    y: 4,
    w: 58,
    h: 58,
  });
  assert.deepEqual(elementBounds({ kind: "datamatrix", x: 0, y: 0, size: 4, data: "x" }), {
    x: 0,
    y: 0,
    w: 64,
    h: 64,
  });
});

test("a whole label reads top to bottom in element order", () => {
  const zpl = renderLabel({
    media: "7030",
    elements: [
      { kind: "text", x: 8, y: 8, text: "돼지고기", size: 24, weight: "B" },
      { kind: "barcode", sym: "code128", x: 8, y: 40, h: 50, module: 2, data: "ABC123" },
    ],
    copies: 2,
  });
  assert.equal(
    zpl,
    [
      "^XA",
      "^CI28",
      "^PW560",
      "^LL240",
      "^LH0,0",
      "^FO8,8^A@N,24,22,E:NOTOKRB.TTF^FH^FD돼지고기^FS",
      "^FO8,40^BY2,3,50^BCN,50,Y,N,N^FH^FDABC123^FS",
      "^PQ2",
      "^XZ",
    ].join("\n"),
  );
});

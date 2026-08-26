// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { buildOrderLabel100100, fitOptionLines, wrapChars } from "./order-100100.ts";
import { MEDIA } from "../media.ts";
import { elementBounds, renderLabel } from "../zpl.ts";

const SAMPLE = {
  orderNo: "SASH-0412",
  dueText: "27/08 14:00",
  nameKo: "모듬사시미 (테스트)",
  nameEn: "Assorted Sashimi Platter",
  qty: 2,
  optionLines: ["Wasabi: Extra x1", "Soy Sauce: Low sodium x2", "Cut: Thick x1"],
  orderQrData: "https://ktpv5.local/order/SASH-0412",
  ppQrData: '00:{"00":2,"01":"9300001","04":512}',
};

test("the label is 800 × 800 and both symbol boxes carry a real QR", () => {
  const zpl = renderLabel(buildOrderLabel100100(SAMPLE));

  assert.ok(zpl.includes("^PW800") && zpl.includes("^LL800"));
  assert.ok(zpl.includes("^FO24,556^GB220,220,3^FS"), "left box");
  assert.ok(zpl.includes("^FO556,556^GB220,220,3^FS"), "right box");
  assert.equal(zpl.split("^BQN,2,5^").length - 1, 2, "two QR symbols");
  assert.ok(zpl.includes(`^FDLA,${SAMPLE.orderQrData}^FS`));
  assert.ok(zpl.includes(`^FDLA,${SAMPLE.ppQrData}^FS`));
});

test("no PP payload, no PP box — an empty 220-dot square prints nothing usefully", () => {
  const zpl = renderLabel(buildOrderLabel100100({ ...SAMPLE, ppQrData: null }));

  assert.ok(zpl.includes("^FO24,556^GB220,220,3^FS"), "the order box stays");
  assert.ok(!zpl.includes("^FO556,556^GB220,220,3^FS"), "the PP box is gone");
  assert.equal(zpl.split("^BQN,2,5^").length - 1, 1);
});

test("the Korean name prints — it used to be dropped for not being ASCII", () => {
  const zpl = renderLabel(buildOrderLabel100100(SAMPLE));
  assert.ok(zpl.includes("^FD모듬사시미 (테스트)^FS"), zpl);
  const koLine = zpl.split("\n").find((line) => line.includes("모듬사시미"));
  assert.match(koLine, /E:NOTOKRB\.TTF/, "Bold, and a real font");
});

test("quantity, order number and due date land in the bottom strip", () => {
  const zpl = renderLabel(buildOrderLabel100100(SAMPLE));
  assert.ok(zpl.includes("^FO24,472^A@N,68,61,E:NOTOKRBK.TTF^FB752,1,0,L,0^FH^FDQTY 2^FS"), zpl);
  assert.ok(zpl.includes("^FDSASH-0412^FS"));
  assert.ok(zpl.includes("^FDDue 27/08 14:00^FS"));

  const noDue = renderLabel(buildOrderLabel100100({ ...SAMPLE, dueText: null }));
  assert.ok(noDue.includes("^FDDue -^FS"));
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

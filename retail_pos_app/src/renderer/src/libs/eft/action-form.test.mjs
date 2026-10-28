// npm run test:sale-core (retail-eftpos T-7) — Action Framework layout walker.
import assert from "node:assert/strict";
import test from "node:test";

import { actionBody, walkActionForm } from "./action-form.ts";

const signatureForm = {
  layout: [
    { horizontal_layout: [{ label: "Verify signature", key: "verify_text" }] },
    { horizontal_layout: [{ key: "approve" }, { key: "decline" }] },
  ],
  properties: {
    verify_text: { type: "text", label: "Check the customer's signature against the card" },
    approve: { type: "button", label: "Approve", submit: true },
    decline: { type: "button", label: "Decline", submit: true },
  },
  details: { Amount: "$1.77", TID: "123456", Extra: { a: 1 } },
};

test("horizontal_layout rows, property labels win, details as-is in order", () => {
  const l = walkActionForm(signatureForm);
  assert.equal(l.rows.length, 2);
  assert.deepEqual(l.rows[0], [{ kind: "text", key: "verify_text", text: "Check the customer's signature against the card" }]);
  assert.deepEqual(
    l.rows[1].map((e) => [e.kind, e.key, e.label, e.submit]),
    [
      ["button", "approve", "Approve", true],
      ["button", "decline", "Decline", true],
    ],
  );
  assert.deepEqual(l.details, [
    { key: "Amount", value: "$1.77" },
    { key: "TID", value: "123456" },
    { key: "Extra", value: '{"a":1}' },
  ]);
});

test("inputs keyed by name, submit posts every input with the version; a named action posts none", () => {
  const form = {
    layout: [{ vertical_layout: [{ key: "ref" }, { key: "note" }] }, { horizontal_layout: [{ key: "go" }, { key: "print" }] }],
    properties: {
      ref: { type: "input", label: "Reference", name: "reference" },
      note: { type: "input", label: "Note" },
      go: { type: "button", label: "Submit", submit: true },
      print: { type: "button", label: "Print", action: "PRINT_MERCHANT_RECEIPT" },
    },
  };
  const l = walkActionForm(form);
  assert.equal(l.rows.length, 3, "vertical_layout = one row per element");
  assert.deepEqual(l.inputNames, ["reference", "note"]);
  const go = l.rows[2][0];
  const print = l.rows[2][1];
  assert.deepEqual(actionBody(l, go, { reference: "R1" }, 7), { buttonKey: "go", inputs: { reference: "R1", note: "" }, version: 7 });
  assert.deepEqual(actionBody(l, print, { reference: "R1" }, 7), { buttonKey: "print", inputs: {}, version: 7 });
  assert.equal(print.action, "PRINT_MERCHANT_RECEIPT");
  assert.equal(print.submit, false);
});

test("image: base64 by mime; bad mime / encoding is unsupported; unknown type is unsupported", () => {
  const l = walkActionForm({
    layout: [{ horizontal_layout: [{ key: "img" }, { key: "bad" }, { key: "x" }] }],
    properties: {
      img: { type: "image", mime: "image/png", encoding: "base64", data: "iVBORw0KGgo=" },
      bad: { type: "image", mime: "text/html", data: "PGgxPg==" },
      x: { type: "carousel" },
    },
  });
  assert.deepEqual(l.rows[0][0], { kind: "image", key: "img", label: "", src: "data:image/png;base64,iVBORw0KGgo=" });
  assert.equal(l.rows[0][1].kind, "unsupported");
  assert.deepEqual(l.rows[0][2], { kind: "unsupported", key: "x", type: "carousel" });
});

test("no layout: each property on its own row in order; empty / missing form is empty", () => {
  const l = walkActionForm({ properties: { a: { type: "text", label: "Hello" }, b: { type: "button", label: "OK", action: "TRANSACTION_COMPLETE" } } });
  assert.deepEqual(l.rows.map((r) => r.map((e) => e.key)), [["a"], ["b"]]);
  assert.deepEqual(walkActionForm(null), { rows: [], details: [], inputNames: [] });
  // a layout key with no property is shown as unsupported rather than dropped
  assert.equal(walkActionForm({ layout: [{ horizontal_layout: [{ key: "ghost" }] }], properties: {} }).rows[0][0].kind, "unsupported");
});

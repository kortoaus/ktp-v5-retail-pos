// node --experimental-strip-types --test src/renderer/src/label-core/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { fieldData } from "./escape.ts";

test("the three ZPL-significant characters become hex escapes", () => {
  assert.equal(fieldData("^"), "_5E");
  assert.equal(fieldData("~"), "_7E");
  assert.equal(fieldData("_"), "_5F");
  assert.equal(fieldData("a^b~c_d"), "a_5Eb_7Ec_5Fd");
});

test("underscore is escaped first, so escapes are not re-escaped", () => {
  // Naive ordering would turn "^" into "_5E" and then into "_5F5E".
  assert.equal(fieldData("^~"), "_5E_7E");
  assert.equal(fieldData("_^"), "_5F_5E");
});

test("hangul survives untouched — this is the whole point of ^CI28", () => {
  assert.equal(fieldData("가나다 한글 ABC 123"), "가나다 한글 ABC 123");
  assert.equal(fieldData("돼지고기 목살 500g"), "돼지고기 목살 500g");
  assert.equal(fieldData("삼겹살^~_"), "삼겹살_5E_7E_5F");
});

test("C0 control characters and DEL are dropped, not escaped", () => {
  assert.equal(fieldData("a\u0001b\u0002c\u001fd"), "abcd");
  assert.equal(fieldData("line1\r\nline2"), "line1line2");
  assert.equal(fieldData("가\u0007나\u007f"), "가나");
});

test("ordinary text passes through byte for byte", () => {
  assert.equal(fieldData("$12.95 / kg"), "$12.95 / kg");
  assert.equal(fieldData(""), "");
});

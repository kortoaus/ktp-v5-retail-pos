// 자유 텍스트 템플릿 입력 검증 — 순수 함수만. Postgres·Express 를 부르지
// 않는다(리포 관례: `store.service.test.ts`).
//
//   npm run build && node --test dist/v1/free-text-template/free-text-template.validate.test.js

import assert from "node:assert/strict";
import test from "node:test";

import {
  LINES_MAX,
  NAME_MAX,
  TEXT_MAX,
  templateNameKey,
  validateFreeTextTemplateInput,
} from "./free-text-template.validate";

const LINE = { text: "Keep refrigerated", size: "M", weight: "B" };

function expectOk(body: unknown) {
  const res = validateFreeTextTemplateInput(body);
  assert.equal(res.ok, true, `expected ok, got: ${JSON.stringify(res)}`);
  if (!res.ok) throw new Error("unreachable");
  return res.value;
}

function expectFail(body: unknown) {
  const res = validateFreeTextTemplateInput(body);
  assert.equal(res.ok, false, `expected failure, got: ${JSON.stringify(res)}`);
  if (res.ok) throw new Error("unreachable");
  assert.ok(res.msg.length > 0, "failure must carry a message");
  return res.msg;
}

// ── 통과 경로 ───────────────────────────────────────────────────────────────

test("valid body passes and returns the trimmed name", () => {
  const value = expectOk({ name: "  Chilled  ", lines: [LINE] });

  assert.equal(value.name, "Chilled");
  assert.deepEqual(value.lines, [LINE]);
});

test("lines are rebuilt from the three known fields only", () => {
  const value = expectOk({
    name: "T",
    lines: [{ ...LINE, id: 9, extra: "drop me" }],
  });

  assert.deepEqual(Object.keys(value.lines[0]).sort(), [
    "size",
    "text",
    "weight",
  ]);
});

test("an empty lines array is allowed — an empty template is not a broken one", () => {
  assert.deepEqual(expectOk({ name: "T", lines: [] }).lines, []);
});

test("empty text is allowed — it is how the editor spells a blank row", () => {
  const value = expectOk({
    name: "T",
    lines: [{ text: "", size: "S", weight: "M" }],
  });
  assert.equal(value.lines[0].text, "");
});

test("every size and weight literal is accepted", () => {
  for (const size of ["S", "M", "L"]) {
    for (const weight of ["M", "B", "BK"]) {
      expectOk({ name: "T", lines: [{ text: "x", size, weight }] });
    }
  }
});

// ── 이름 ────────────────────────────────────────────────────────────────────

test("name must be a non-blank string", () => {
  expectFail({ lines: [] });
  expectFail({ name: null, lines: [] });
  expectFail({ name: 7, lines: [] });
  expectFail({ name: "", lines: [] });
  expectFail({ name: "   ", lines: [] });
});

test("name length is capped after trimming", () => {
  expectOk({ name: "n".repeat(NAME_MAX), lines: [] });
  expectOk({ name: `  ${"n".repeat(NAME_MAX)}  `, lines: [] });
  expectFail({ name: "n".repeat(NAME_MAX + 1), lines: [] });
});

// ── 줄 ──────────────────────────────────────────────────────────────────────

test("lines must be an array", () => {
  expectFail({ name: "T" });
  expectFail({ name: "T", lines: null });
  expectFail({ name: "T", lines: "nope" });
  expectFail({ name: "T", lines: { 0: LINE } });
});

test("line count is capped", () => {
  const many = (n: number) => Array.from({ length: n }, () => LINE);
  expectOk({ name: "T", lines: many(LINES_MAX) });
  expectFail({ name: "T", lines: many(LINES_MAX + 1) });
});

test("text length is capped", () => {
  expectOk({ name: "T", lines: [{ ...LINE, text: "x".repeat(TEXT_MAX) }] });
  expectFail({ name: "T", lines: [{ ...LINE, text: "x".repeat(TEXT_MAX + 1) }] });
});

test("a malformed line rejects the whole request, not just that line", () => {
  const msg = expectFail({
    name: "T",
    lines: [LINE, { text: "x", size: "XL", weight: "M" }, LINE],
  });
  assert.match(msg, /lines\[1\]/, "the message names the offending index");
});

test("each line field is checked", () => {
  expectFail({ name: "T", lines: [null] });
  expectFail({ name: "T", lines: [[LINE]] });
  expectFail({ name: "T", lines: ["text"] });
  expectFail({ name: "T", lines: [{ size: "M", weight: "M" }] });
  expectFail({ name: "T", lines: [{ text: 7, size: "M", weight: "M" }] });
  expectFail({ name: "T", lines: [{ text: "x", weight: "M" }] });
  expectFail({ name: "T", lines: [{ text: "x", size: "m", weight: "M" }] });
  expectFail({ name: "T", lines: [{ text: "x", size: "M" }] });
  expectFail({ name: "T", lines: [{ text: "x", size: "M", weight: "b" }] });
  expectFail({ name: "T", lines: [{ text: "x", size: "M", weight: "X" }] });
});

// ── body 자체 ───────────────────────────────────────────────────────────────

test("a non-object body is rejected", () => {
  expectFail(null);
  expectFail(undefined);
  expectFail("string");
  expectFail(42);
  expectFail([{ name: "T", lines: [] }]);
});

// ── 이름 키 ─────────────────────────────────────────────────────────────────

test("templateNameKey ignores surrounding space and case", () => {
  assert.equal(templateNameKey("  Chilled "), "chilled");
  assert.equal(templateNameKey("CHILLED"), templateNameKey("chilled"));
  assert.notEqual(templateNameKey("Chilled"), templateNameKey("Chilled 2"));
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildCollectBody, classifyCollectResult } from "./order.collect.service";

// ── buildCollectBody — crm 계약 body 는 {posInvoiceSerial} 뿐 ──

test("buildCollectBody carries only posInvoiceSerial (no version)", () => {
  const body = buildCollectBody("1-20260821-S000123");
  assert.deepEqual(body, { posInvoiceSerial: "1-20260821-S000123" });
  assert.deepEqual(Object.keys(body), ["posInvoiceSerial"]);
});

// ── classifyCollectResult — 스윕 판정 로직 ──

test("ok response classifies as synced (incl. idempotent same-serial 200)", () => {
  assert.equal(classifyCollectResult({ ok: true, status: 200 }), "synced");
  assert.equal(classifyCollectResult({ ok: true }), "synced");
});

test("409 TRANSITION_CONFLICT classifies as permanent conflict", () => {
  assert.equal(classifyCollectResult({ ok: false, status: 409 }), "conflict");
});

test("network failure (status 0) classifies as retry", () => {
  assert.equal(classifyCollectResult({ ok: false, status: 0 }), "retry");
});

test("5xx / 4xx (non-409) / missing status classify as retry", () => {
  assert.equal(classifyCollectResult({ ok: false, status: 503 }), "retry");
  assert.equal(classifyCollectResult({ ok: false, status: 500 }), "retry");
  assert.equal(classifyCollectResult({ ok: false, status: 400 }), "retry");
  assert.equal(classifyCollectResult({ ok: false, status: 401 }), "retry");
  assert.equal(classifyCollectResult({ ok: false }), "retry");
});

// ok:false 만 409 로 취급 — ok:true 면 status 와 무관하게 synced (crm 응답
// 정규화 계층이 ok 를 정본으로 삼는 관례).
test("ok flag wins over status", () => {
  assert.equal(classifyCollectResult({ ok: true, status: 409 }), "synced");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCollectBody,
  classifyCollectResult,
  toCollectSaleResult,
} from "./order.collect.service";

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

// S3 리뷰 반영 — 4xx 는 재시도해도 같은 응답이라 스윕 head-of-line poison 이
// 된다. 409 와 같이 영구 처리 (synced 마킹 + warn).
test("other 4xx (400/404/422) classify as permanent conflict", () => {
  assert.equal(classifyCollectResult({ ok: false, status: 400 }), "conflict");
  assert.equal(classifyCollectResult({ ok: false, status: 404 }), "conflict");
  assert.equal(classifyCollectResult({ ok: false, status: 422 }), "conflict");
});

// 예외 — 401/403 은 .env API_KEY 미스컨피그: 키를 고치면 회복되므로 synced
// 마킹으로 collect 를 유실하지 않게 retry 로 남긴다.
test("auth 401/403 classify as retry (recoverable misconfig)", () => {
  assert.equal(classifyCollectResult({ ok: false, status: 401 }), "retry");
  assert.equal(classifyCollectResult({ ok: false, status: 403 }), "retry");
});

test("network failure (status 0) classifies as retry", () => {
  assert.equal(classifyCollectResult({ ok: false, status: 0 }), "retry");
});

test("5xx / missing status classify as retry", () => {
  assert.equal(classifyCollectResult({ ok: false, status: 503 }), "retry");
  assert.equal(classifyCollectResult({ ok: false, status: 500 }), "retry");
  assert.equal(classifyCollectResult({ ok: false }), "retry");
});

// ok:false 만 409 로 취급 — ok:true 면 status 와 무관하게 synced (crm 응답
// 정규화 계층이 ok 를 정본으로 삼는 관례).
test("ok flag wins over status", () => {
  assert.equal(classifyCollectResult({ ok: true, status: 409 }), "synced");
});

// ── toCollectSaleResult — 판매 응답 DTO 트라이스테이트 매핑 (S3 리뷰) ──

test("outcome maps to response tri-state", () => {
  assert.equal(toCollectSaleResult("synced"), "collected");
  assert.equal(toCollectSaleResult("conflict"), "conflict");
  assert.equal(toCollectSaleResult("retry"), "pending");
  assert.equal(toCollectSaleResult("timeout"), "pending");
});

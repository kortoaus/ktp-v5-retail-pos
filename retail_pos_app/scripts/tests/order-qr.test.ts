import assert from "node:assert/strict";
import { parseOrderQr } from "../../src/renderer/src/libs/order-qr.ts";

// 정상 — 픽업리스트 QR (슬라이스 C 포맷)
assert.deepEqual(parseOrderQr("order%%%42"), { orderId: 42 });
assert.deepEqual(parseOrderQr("order%%%1"), { orderId: 1 });

// 전방 호환 — 추가 세그먼트 무시 (member-qr 관례)
assert.deepEqual(parseOrderQr("order%%%42%%%extra"), { orderId: 42 });

// 비양수/비정수 id → null
assert.equal(parseOrderQr("order%%%0"), null);
assert.equal(parseOrderQr("order%%%-3"), null);
assert.equal(parseOrderQr("order%%%abc"), null);
assert.equal(parseOrderQr("order%%%1.5"), null);
assert.equal(parseOrderQr("order%%%042"), null); // 선행 0 불인정
assert.equal(parseOrderQr("order%%%"), null);

// 다른 프리픽스는 손대지 않음 (스캔 디스패치 우선순위와 무관하게 안전)
assert.equal(parseOrderQr("member%%%crm-42"), null);
assert.equal(parseOrderQr("9312345678901"), null);
assert.equal(parseOrderQr(""), null);

console.log("order-qr tests passed");

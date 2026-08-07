import assert from "node:assert/strict";
import { parseMemberQr } from "../../src/renderer/src/libs/member-qr.ts";

// 구형 QR — level 없음
assert.deepEqual(parseMemberQr("member%%%crm-42"), {
  memberId: "crm-42",
  level: null,
});

// 신형 QR — level 탑재
assert.deepEqual(parseMemberQr("member%%%crm-42%%%3"), {
  memberId: "crm-42",
  level: 3,
});

// 쓰레기 level → null
assert.deepEqual(parseMemberQr("member%%%crm-42%%%abc"), {
  memberId: "crm-42",
  level: null,
});
assert.deepEqual(parseMemberQr("member%%%crm-42%%%0"), {
  memberId: "crm-42",
  level: null,
});
assert.deepEqual(parseMemberQr("member%%%crm-42%%%-1"), {
  memberId: "crm-42",
  level: null,
});

// 세그먼트 3+ 무시 (전방 호환)
assert.deepEqual(parseMemberQr("member%%%crm-42%%%3%%%extra"), {
  memberId: "crm-42",
  level: 3,
});

// id 없음 / prefix 불일치 → null
assert.equal(parseMemberQr("member%%%"), null);
assert.equal(parseMemberQr("receipt%%%INV-1"), null);
assert.equal(parseMemberQr("plain-barcode"), null);

console.log("member-qr tests passed");

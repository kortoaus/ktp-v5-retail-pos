import assert from "node:assert/strict";
import { parseMemberQr } from "../../src/renderer/src/libs/member-qr.ts";

// 구형 QR — level 없음
assert.deepEqual(parseMemberQr("member%%%crm-42"), {
  memberId: "crm-42",
  level: null,
  companyId: null,
});

// 신형 QR — level 탑재
assert.deepEqual(parseMemberQr("member%%%crm-42%%%3"), {
  memberId: "crm-42",
  level: 3,
  companyId: null,
});

// 쓰레기 level → null
assert.deepEqual(parseMemberQr("member%%%crm-42%%%abc"), {
  memberId: "crm-42",
  level: null,
  companyId: null,
});
assert.deepEqual(parseMemberQr("member%%%crm-42%%%0"), {
  memberId: "crm-42",
  level: null,
  companyId: null,
});
assert.deepEqual(parseMemberQr("member%%%crm-42%%%-1"), {
  memberId: "crm-42",
  level: null,
  companyId: null,
});

// D-27 — 네 번째 세그먼트 = 회사 id (양의 정수만, 그 외 null)
assert.deepEqual(parseMemberQr("member%%%crm-42%%%3%%%48"), {
  memberId: "crm-42",
  level: 3,
  companyId: 48,
});
for (const bad of ["extra", "0", "-1", "4.5", "", "048"]) {
  assert.equal(parseMemberQr(`member%%%crm-42%%%3%%%${bad}`)?.companyId, null);
}

// 다섯 번째 이후 세그먼트 무시 (전방 호환)
assert.deepEqual(parseMemberQr("member%%%crm-42%%%3%%%48%%%extra"), {
  memberId: "crm-42",
  level: 3,
  companyId: 48,
});

// id 없음 / prefix 불일치 → null
assert.equal(parseMemberQr("member%%%"), null);
assert.equal(parseMemberQr("receipt%%%INV-1"), null);
assert.equal(parseMemberQr("plain-barcode"), null);

console.log("member-qr tests passed");

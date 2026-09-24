import assert from "node:assert/strict";
import test from "node:test";

import { UnauthorizedException } from "../../libs/exceptions";
import { buildDeliveryManifestQs, resolvePickerName } from "./order.controller";

// --- S2 피킹 프록시: pickerName 정규화(컨트롤러 책임) ---

test("resolvePickerName trims the staff name and caps it at 50 chars", () => {
  assert.equal(resolvePickerName({ name: "  Alice  " }), "Alice");
  assert.equal(resolvePickerName({ name: "a".repeat(60) }), "a".repeat(50));
});

test("resolvePickerName rejects a blank staff name locally, never forwarding it to crm", () => {
  assert.throws(
    () => resolvePickerName({ name: "" }),
    (e: unknown) =>
      e instanceof UnauthorizedException &&
      e.message === "Staff user has no display name",
  );
  assert.throws(
    () => resolvePickerName({ name: "   " }),
    UnauthorizedException,
  );
});

// --- 드라이버 런시트: 매니페스트 쿼리 화이트리스트 ---

test("buildDeliveryManifestQs passes date/ids and only include=contactPhone", () => {
  assert.equal(buildDeliveryManifestQs({ date: "2026-09-24" }), "date=2026-09-24");
  assert.equal(
    buildDeliveryManifestQs({ ids: "3,1", include: "contactPhone", foo: "x" }),
    "ids=3%2C1&include=contactPhone",
  );
  assert.equal(buildDeliveryManifestQs({ ids: ["1", "2"] }), ""); // 배열 등 비문자열 키는 버림
  for (const include of ["", "phone", "contactPhone,address", ["contactPhone"]]) {
    assert.throws(() => buildDeliveryManifestQs({ include }), /include must be contactPhone/);
  }
});

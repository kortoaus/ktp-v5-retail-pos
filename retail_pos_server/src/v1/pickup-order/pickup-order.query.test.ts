import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPickupOrderKeywordWhere,
  parsePickupOrderListQuery,
} from "./pickup-order.repository";

test("parsePickupOrderListQuery defaults page and limit", () => {
  const query = parsePickupOrderListQuery({});
  assert.equal(query.page, 1);
  assert.equal(query.limit, 20);
});

test("parsePickupOrderListQuery accepts status and keyword", () => {
  const query = parsePickupOrderListQuery({
    status: "PENDING",
    keyword: "  rice  ",
    page: "2",
    limit: "50",
  });
  assert.equal(query.status, "PENDING");
  assert.equal(query.keyword, "rice");
  assert.equal(query.page, 2);
  assert.equal(query.limit, 50);
});

test("parsePickupOrderListQuery rejects unknown status", () => {
  assert.throws(
    () => parsePickupOrderListQuery({ status: "PRINTED" }),
    /status must be a valid pickup order status/,
  );
});

test("buildPickupOrderKeywordWhere searches order and line fields", () => {
  const where = buildPickupOrderKeywordWhere("rice");
  assert.ok(where.OR);
  assert.equal(where.OR.length, 3);
});

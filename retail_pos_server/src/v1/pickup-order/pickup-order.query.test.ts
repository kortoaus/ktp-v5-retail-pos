import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPendingPickupOrderCountWhere,
  buildPickupOrderListWhere,
  buildPickupOrderListOrderBy,
  buildPickupOrderPaging,
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

test("parsePickupOrderListQuery accepts memberId", () => {
  const query = parsePickupOrderListQuery({ memberId: "crm-member-7" });
  assert.equal(query.memberId, "crm-member-7");
});

test("parsePickupOrderListQuery accepts earliest-first sort", () => {
  const query = parsePickupOrderListQuery({ sort: "pickupStartsAtAsc" });
  assert.equal(query.sort, "pickupStartsAtAsc");
});

test("parsePickupOrderListQuery rejects unknown sort", () => {
  assert.throws(
    () => parsePickupOrderListQuery({ sort: "crmCreatedAtAsc" }),
    /sort must be a valid pickup order sort/,
  );
});

test("parsePickupOrderListQuery accepts multiple statuses", () => {
  const query = parsePickupOrderListQuery({
    statuses: "PENDING,ORDER_CONFIRMED,READY",
  });
  assert.deepEqual(query.statuses, ["PENDING", "ORDER_CONFIRMED", "READY"]);
});

test("parsePickupOrderListQuery rejects unknown statuses entry", () => {
  assert.throws(
    () => parsePickupOrderListQuery({ statuses: "PENDING,PRINTED" }),
    /statuses must contain valid pickup order statuses/,
  );
});

test("parsePickupOrderListQuery trims blank memberId away", () => {
  const query = parsePickupOrderListQuery({ memberId: "   " });
  assert.equal(query.memberId, undefined);
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

test("buildPickupOrderListWhere combines status dates member and keyword", () => {
  const query = parsePickupOrderListQuery({
    status: "READY",
    keyword: "salmon",
    memberId: "member-1",
    from: "2026-07-07T00:00:00.000Z",
    to: "2026-07-08T00:00:00.000Z",
  });

  const where = buildPickupOrderListWhere(query);

  assert.equal(where.status, "READY");
  assert.equal(where.memberId, "member-1");
  assert.deepEqual(where.pickupStartsAt, {
    gte: new Date("2026-07-07T00:00:00.000Z"),
    lte: new Date("2026-07-08T00:00:00.000Z"),
  });
  assert.ok(where.OR);
});

test("buildPickupOrderListWhere applies multiple status filter", () => {
  const query = parsePickupOrderListQuery({
    statuses: "PENDING,ORDER_CONFIRMED,READY",
  });

  const where = buildPickupOrderListWhere(query);

  assert.deepEqual(where.status, { in: ["PENDING", "ORDER_CONFIRMED", "READY"] });
});

test("buildPickupOrderPaging returns renderer paging shape", () => {
  assert.deepEqual(
    buildPickupOrderPaging({ page: 2, limit: 20, totalCount: 55 }),
    {
      hasPrev: true,
      hasNext: true,
      currentPage: 2,
      totalPages: 3,
    },
  );
});

test("buildPickupOrderListOrderBy returns newest pickup orders first", () => {
  assert.deepEqual(buildPickupOrderListOrderBy({ sort: "pickupStartsAtDesc" }), [
    { pickupStartsAt: "desc" },
    { crmOrderId: "desc" },
  ]);
});

test("buildPickupOrderListOrderBy returns earliest pickup orders first", () => {
  assert.deepEqual(buildPickupOrderListOrderBy({ sort: "pickupStartsAtAsc" }), [
    { pickupStartsAt: "asc" },
    { crmOrderId: "asc" },
  ]);
});

test("buildPendingPickupOrderCountWhere counts pending orders from the provided day boundary", () => {
  const from = new Date("2026-07-07T14:00:00.000Z");

  assert.deepEqual(buildPendingPickupOrderCountWhere(from), {
    status: "PENDING",
    pickupStartsAt: { gte: from },
  });
});

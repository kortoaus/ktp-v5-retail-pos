import assert from "node:assert/strict";
import test from "node:test";
import { getPickupOrderMemberPhoneByCrmOrderId } from "./pickup-order.member-phone";
import {
  InternalServerException,
  NotFoundException,
  UnauthorizedException,
} from "../../libs/exceptions";

test("getPickupOrderMemberPhoneByCrmOrderId returns CRM phone for cached order member", async () => {
  const requestedMemberIds: string[] = [];
  const result = await getPickupOrderMemberPhoneByCrmOrderId(7, {
    async findOrderMemberId(crmOrderId: number) {
      assert.equal(crmOrderId, 7);
      return { memberId: "member-1" };
    },
    async requestCrmPhone(memberId: string) {
      requestedMemberIds.push(memberId);
      return {
        ok: true,
        msg: "ok",
        result: {
          memberId,
          phone: "+614123456789",
          phoneLast4: "6789",
        },
        paging: null,
      };
    },
  });

  assert.deepEqual(requestedMemberIds, ["member-1"]);
  assert.deepEqual(result, {
    ok: true,
    msg: "Member phone loaded",
    result: {
      memberId: "member-1",
      phone: "+614123456789",
      phoneLast4: "6789",
    },
    paging: null,
  });
});

test("getPickupOrderMemberPhoneByCrmOrderId rejects when cached order is missing", async () => {
  let crmCalled = false;

  await assert.rejects(
    () =>
      getPickupOrderMemberPhoneByCrmOrderId(7, {
        async findOrderMemberId() {
          return null;
        },
        async requestCrmPhone() {
          crmCalled = true;
          return {
            ok: true,
            result: {
              memberId: "member-1",
              phone: "+614123456789",
              phoneLast4: "6789",
            },
          };
        },
      }),
    (error: unknown) => {
      assert.equal(crmCalled, false);
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.message, "Pickup order not found");
      return true;
    },
  );
});

test("getPickupOrderMemberPhoneByCrmOrderId maps CRM auth failure to UnauthorizedException", async () => {
  await assert.rejects(
    () =>
      getPickupOrderMemberPhoneByCrmOrderId(7, {
        async findOrderMemberId() {
          return { memberId: "member-1" };
        },
        async requestCrmPhone() {
          return {
            ok: false,
            status: 401,
            msg: "Unauthorized",
            result: null,
          };
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof UnauthorizedException);
      assert.equal(error.message, "Unauthorized");
      return true;
    },
  );
});

test("getPickupOrderMemberPhoneByCrmOrderId maps CRM network failure to InternalServerException", async () => {
  await assert.rejects(
    () =>
      getPickupOrderMemberPhoneByCrmOrderId(7, {
        async findOrderMemberId() {
          return { memberId: "member-1" };
        },
        async requestCrmPhone() {
          return {
            ok: false,
            status: 0,
            msg: "Network Error",
            result: null,
          };
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof InternalServerException);
      assert.equal(error.message, "CRM member phone service unavailable");
      return true;
    },
  );
});

test("getPickupOrderMemberPhoneByCrmOrderId maps CRM server failure to InternalServerException", async () => {
  await assert.rejects(
    () =>
      getPickupOrderMemberPhoneByCrmOrderId(7, {
        async findOrderMemberId() {
          return { memberId: "member-1" };
        },
        async requestCrmPhone() {
          return {
            ok: false,
            status: 500,
            msg: "Server Error",
            result: null,
          };
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof InternalServerException);
      assert.equal(error.message, "CRM member phone service unavailable");
      return true;
    },
  );
});

test("getPickupOrderMemberPhoneByCrmOrderId treats malformed CRM success as InternalServerException", async () => {
  await assert.rejects(
    () =>
      getPickupOrderMemberPhoneByCrmOrderId(7, {
        async findOrderMemberId() {
          return { memberId: "member-1" };
        },
        async requestCrmPhone() {
          return {
            ok: true,
            status: 200,
            msg: "Success",
            result: null,
          };
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof InternalServerException);
      assert.equal(error.message, "CRM member phone service unavailable");
      return true;
    },
  );
});

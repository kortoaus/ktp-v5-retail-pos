import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { Request, Response } from "express";

import { crmApiService } from "../../libs/cloud.api";
import {
  searchMemberByIdController,
  searchMemberController,
  searchMembersByKeywordController,
} from "./crm.controller";

// F-20 / D-27 — member lookups: a CRM transport failure → HTTP 503 with
// `transport`; any CRM answer (incl. its own 404/503) → HTTP 200 + CRM body.

type Sent = { status: number; body: any };

function fakeRes(): { res: Response; sent: Sent } {
  const sent: Sent = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, sent };
}

const controllers = [
  ["search/id", searchMemberByIdController, { memberId: "m1" }],
  ["search/phone", searchMemberController, { phone: "0400000000" }],
  ["search/keyword", searchMembersByKeywordController, { keyword: "kim" }],
] as const;

for (const [name, controller, body] of controllers) {
  for (const transport of ["network", "timeout"] as const) {
    test(`${name}: CRM ${transport} failure → 503 CRM unreachable`, async (t) => {
      t.after(() => mock.restoreAll());
      mock.method(crmApiService, "post", async () => ({
        ok: false,
        msg: "Server Error",
        status: 500,
        transport,
        result: null,
        paging: null,
      }));
      const { res, sent } = fakeRes();
      await controller({ body } as Request, res);
      assert.equal(sent.status, 503);
      assert.deepEqual(sent.body, {
        ok: false,
        msg: "CRM unreachable",
        transport,
        result: null,
      });
    });
  }

  test(`${name}: CRM 404 answer passes through (HTTP 200, status 404, msg)`, async (t) => {
    t.after(() => mock.restoreAll());
    const answer = {
      ok: false,
      msg: "Member not found",
      message: "Member not found",
      status: 404,
      result: null,
      paging: null,
    };
    mock.method(crmApiService, "post", async () => answer);
    const { res, sent } = fakeRes();
    await controller({ body } as Request, res);
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body, answer);
    assert.equal(sent.body.status, 404);
  });

  test(`${name}: CRM's own 503 (HTTP answer, no transport) is not offline`, async (t) => {
    t.after(() => mock.restoreAll());
    const answer = { ok: false, msg: "Service Unavailable", status: 503, result: null, paging: null };
    mock.method(crmApiService, "post", async () => answer);
    const { res, sent } = fakeRes();
    await controller({ body } as Request, res);
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body, answer);
  });

  test(`${name}: CRM ok answer passes through unchanged`, async (t) => {
    t.after(() => mock.restoreAll());
    const answer = { ok: true, msg: "Success", status: 200, result: { id: "m1" }, paging: null };
    const post = mock.method(crmApiService, "post", async () => answer);
    const { res, sent } = fakeRes();
    await controller({ body } as Request, res);
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body, answer);
    assert.equal(post.mock.calls[0].arguments[0], `/device/member/${name}`);
    assert.deepEqual(post.mock.calls[0].arguments[1], body);
  });
}

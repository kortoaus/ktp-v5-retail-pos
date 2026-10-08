import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";

import { UnauthorizedException } from "../../libs/exceptions";
import type { UserModel } from "../../generated/prisma/models";
import {
  STAFF_SESSION_TTL_SECONDS,
  parseStaffAuthAccept,
  resolveStaffSessionSecret,
  signStaffSession,
} from "./staff-session";
import {
  STAFF_SESSION_INVALID,
  createUserMiddleware,
} from "./user.middleware";
import type { StaffAuthAccept } from "./staff-session";

// R-1 — staff session verification. Offline: users come from an in-memory map.

const SECRET = "test-secret-for-staff-sessions";

function user(id: number, archived = false): UserModel {
  return {
    id,
    name: `User ${id}`,
    code: `C${id}`,
    scope: ["sale"],
    archived,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as UserModel;
}

const USERS = new Map<number, UserModel>([
  [7, user(7)],
  [8, user(8, true)],
]);

function setup(accept: StaffAuthAccept = "both") {
  const infos: string[] = [];
  const mw = createUserMiddleware({
    findUser: async (id) => USERS.get(id) ?? null,
    config: () => ({ secret: SECRET, accept }),
    log: { info: (m: string) => void infos.push(m) },
  });
  async function call(token: string | null) {
    const req = {
      headers: token == null ? {} : { authorization: `Bearer ${token}` },
      baseUrl: "/api/sale",
      path: "/",
    } as unknown as Request;
    const res = { locals: {} as Record<string, unknown> } as unknown as Response;
    let nextCalled = false;
    await mw(req, res, () => {
      nextCalled = true;
    });
    return { res, nextCalled };
  }
  return { call, infos };
}

async function assertStaff401(p: Promise<unknown>, msg?: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof UnauthorizedException);
    assert.equal(e.statusCode, 401);
    assert.deepEqual(e.result, { code: STAFF_SESSION_INVALID });
    if (msg) assert.match(e.message, msg);
    return true;
  });
}

test("signed session: claims typ/sub/iat/exp/jti, HS256, exp ≤ 14 h", () => {
  const token = signStaffSession(7, SECRET);
  const decoded = jwt.decode(token, { complete: true });
  assert.ok(decoded && typeof decoded.payload !== "string");
  assert.equal(decoded.header.alg, "HS256");
  const p = decoded.payload as jwt.JwtPayload;
  assert.equal(p.typ, "staff");
  assert.equal(p.sub, "7");
  assert.equal(typeof p.iat, "number");
  assert.equal(typeof p.jti, "string");
  assert.ok(p.exp! - p.iat! <= STAFF_SESSION_TTL_SECONDS);
  assert.equal(STAFF_SESSION_TTL_SECONDS, 14 * 3600);
  // ttl requests above 14 h are clamped
  const long = jwt.decode(signStaffSession(7, SECRET, 99 * 3600)) as jwt.JwtPayload;
  assert.ok(long.exp! - long.iat! <= STAFF_SESSION_TTL_SECONDS);
});

test("valid session → next(), locals.user set, no legacy INFO", async () => {
  const { call, infos } = setup("session");
  const { res, nextCalled } = await call(signStaffSession(7, SECRET));
  assert.ok(nextCalled);
  assert.equal(res.locals.userId, 7);
  assert.equal((res.locals.user as UserModel).id, 7);
  assert.equal(res.locals.placedBy, "User 7(7)");
  assert.deepEqual(infos, []);
});

test("expired session → 401", async () => {
  const { call } = setup();
  const past = Math.floor(Date.now() / 1000) - 3600;
  const expired = jwt.sign(
    { typ: "staff", sub: "7", iat: past - 60, exp: past, jti: "x" },
    SECRET,
    { algorithm: "HS256" },
  );
  await assertStaff401(call(expired), /expired/);
});

test("bad signature → 401", async () => {
  const { call } = setup();
  const forged = signStaffSession(7, "some-other-secret");
  await assertStaff401(call(forged), /bad session token/);
  // alg none / tampered payload
  const [h, , s] = signStaffSession(7, SECRET).split(".");
  const body = Buffer.from(JSON.stringify({ typ: "staff", sub: "1", exp: 9e9 })).toString("base64url");
  await assertStaff401(call(`${h}.${body}.${s}`));
  const none = jwt.sign({ typ: "staff", sub: "7" }, "", { algorithm: "none" });
  await assertStaff401(call(none));
});

test("token with typ ≠ staff → 401", async () => {
  const { call } = setup();
  const other = jwt.sign({ typ: "device", sub: "7" }, SECRET, {
    algorithm: "HS256",
    expiresIn: 600,
  });
  await assertStaff401(call(other), /not a staff session/);
  const noTyp = jwt.sign({ sub: "7" }, SECRET, { algorithm: "HS256", expiresIn: 600 });
  await assertStaff401(call(noTyp), /not a staff session/);
});

test("session without exp → 401", async () => {
  const { call } = setup();
  const noExp = jwt.sign({ typ: "staff", sub: "7" }, SECRET, { algorithm: "HS256" });
  await assertStaff401(call(noExp), /no expiry/);
});

test("archived user → 401 on session and legacy paths", async () => {
  const { call, infos } = setup("both");
  await assertStaff401(call(signStaffSession(8, SECRET)), /archived/);
  await assertStaff401(call(`8%%%${Date.now()}`), /archived/);
  assert.deepEqual(infos, []);
});

test("unknown user / missing header → 401", async () => {
  const { call } = setup();
  await assertStaff401(call(signStaffSession(99, SECRET)), /not found/);
  await assertStaff401(call(null));
});

test("legacy token accepted in both, with one INFO line", async () => {
  const { call, infos } = setup("both");
  const { res, nextCalled } = await call(`7%%%${Date.now()}`);
  assert.ok(nextCalled);
  assert.equal(res.locals.userId, 7);
  assert.deepEqual(infos, [
    "[staff-auth] legacy token accepted route=/api/sale/ userId=7",
  ]);
});

test("legacy token rejected in session mode", async () => {
  const { call, infos } = setup("session");
  await assertStaff401(call(`7%%%${Date.now()}`), /legacy token not accepted/);
  assert.deepEqual(infos, []);
});

test("malformed legacy ids are rejected", async () => {
  const { call } = setup("both");
  await assertStaff401(call("abc%%%1"));
  await assertStaff401(call("-1%%%1"));
  await assertStaff401(call("7x%%%1"));
});

test("STAFF_AUTH_ACCEPT parsing defaults to both", () => {
  const warns: string[] = [];
  const log = { warn: (m: string) => void warns.push(m) };
  assert.equal(parseStaffAuthAccept(undefined, log), "both");
  assert.equal(parseStaffAuthAccept("both", log), "both");
  assert.equal(parseStaffAuthAccept(" SESSION ", log), "session");
  assert.equal(warns.length, 0);
  assert.equal(parseStaffAuthAccept("sesion", log), "both");
  assert.equal(warns.length, 1);
});

test("STAFF_SESSION_SECRET unset → random secret + exactly one WARN", () => {
  const warns: string[] = [];
  const log = { warn: (m: string) => void warns.push(m) };
  assert.equal(resolveStaffSessionSecret("configured", log), "configured");
  assert.equal(warns.length, 0);
  const a = resolveStaffSessionSecret(undefined, log);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /STAFF_SESSION_SECRET is not set/);
  assert.ok(a.length >= 32);
  assert.notEqual(resolveStaffSessionSecret("", { warn() {} }), a);
});

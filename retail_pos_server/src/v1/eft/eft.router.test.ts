import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express, { type NextFunction, type Request, type Response } from "express";
import { HttpException } from "../../libs/exceptions";
import { startFakeSci } from "../../dev/fake-sci";
import type { EftConfig } from "./eft.config";
import { decryptSecret } from "./eft.crypto";
import { EftEngine } from "./eft.engine";
import { createEftRouter } from "./eft.router";
import { MemoryEftStore } from "./eft.test-fakes";
import { SciProvider } from "./sci/sci.provider";

// /api/eft/* over HTTP: envelope, status codes, long-poll expiry = 200, and no
// key_id / secret / SCI base URL in any response body.

const PART_A = "router-part-a";
const SECRET_KEY = "c".repeat(64);

async function setup(cfg: Partial<EftConfig> = {}) {
  const fake = await startFakeSci({ port: 0, partA: PART_A, stepMs: 30, holdMs: 150, log: () => undefined });
  const store = new MemoryEftStore();
  const config: EftConfig = {
    pairingApiUrl: fake.url, pairingApiKey: "k", signingSecretPartA: PART_A, secretKeyHex: SECRET_KEY,
    pollDeadlineMs: 5000, laneHoldMs: 200, eventRetentionDays: 180, lateWatchMs: 100, retryBackoffMs: 10, ...cfg,
  };
  const engine = new EftEngine({ store, config, providerFor: () => new SciProvider({ pairingApiUrl: fake.url, pairingApiKey: "k", signingSecretPartA: PART_A }), log: () => undefined });
  const app = express();
  app.use(express.json());
  // Stand-ins for terminalMiddleware + userMiddleware (the real ones read the DB).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.terminal = { id: 1, eftPairingId: store.terminals[0].eftPairingId };
    res.locals.userId = 5;
    next();
  });
  app.use("/api/eft", createEftRouter(() => engine, []));
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpException) {
      res.status(err.statusCode).json(err.result == null ? { ok: false, msg: err.message } : { ok: false, msg: err.message, result: err.result });
      return;
    }
    res.status(500).json({ ok: false, msg: String(err) });
  });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/eft`;
  const bodies: string[] = [];
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    bodies.push(text);
    return { status: res.status, json: JSON.parse(text) };
  };
  const close = async () => {
    await engine.stop();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fake.stop();
  };
  return { fake, store, engine, call, close, bodies, base };
}

test("lane API over HTTP: pair, select, create (201 then 200), long poll, signature action, events, lanes", async () => {
  const h = await setup();
  try {
    const paired = await h.call("POST", "/pairings", { pairingCode: "123456", nickname: "Front" });
    assert.equal(paired.status, 200);
    assert.equal(paired.json.result.confirmationCode, "456456");
    const pid = paired.json.result.id;
    assert.equal((await h.call("POST", `/pairings/${pid}/select`)).status, 200);
    assert.equal((await h.call("POST", `/pairings/${pid}/test`)).json.result.ok, true);
    assert.equal((await h.call("GET", "/pairings")).json.result[0].selectedForThisTerminal, true);

    const created = await h.call("POST", "/transactions", { operationId: "op-http-0001", kind: "PURCHASE", amountCents: 277 });
    assert.equal(created.status, 201);
    const id = created.json.result.id;
    const again = await h.call("POST", "/transactions", { operationId: "op-http-0001", kind: "PURCHASE", amountCents: 277 });
    assert.equal(again.status, 200);
    assert.equal(again.json.result.id, id);

    let v = created.json.result;
    while (v.status !== "AWAITING_POS") v = (await h.call("GET", `/transactions/${id}?min_version=${v.version + 1}`)).json.result;
    assert.equal(v.actionForm.properties.approve.submit, true);
    assert.equal(v.actionForm.properties.approve.submit_url, undefined);

    // Hold expiry answers 200 with the current state (never 404).
    const t0 = Date.now();
    const held = await h.call("GET", `/transactions/${id}?min_version=${v.version + 50}`);
    assert.equal(held.status, 200);
    assert.ok(Date.now() - t0 >= 180);
    assert.equal(held.json.result.version, v.version);

    const acted = await h.call("POST", `/transactions/${id}/actions`, { buttonKey: "approve", inputs: {} });
    assert.equal(acted.status, 200);
    assert.equal(acted.json.result.financialStatus, "APPROVED");

    const events = await h.call("GET", `/transactions/${id}/events`);
    assert.ok(events.json.result.length > 5);
    const lanes = await h.call("GET", "/lanes");
    assert.equal(lanes.json.result.lanes[0].lastTransaction.id, id);
    assert.ok(lanes.json.result.serverTime);

    assert.equal((await h.call("GET", `/transactions/${id}?min_version=-1`)).status, 400);
    assert.equal((await h.call("GET", "/transactions/unknown-id")).status, 404);
    const override = await h.call("POST", `/transactions/${id}/override`, { answer: "YES" });
    assert.equal(override.status, 409);
    assert.match(override.json.msg, /\[POS\]$/);
    assert.equal(override.json.result.errorClass, "POS");

    const p = h.store.pairings[0];
    const all = h.bodies.join("\n");
    for (const s of [p.keyId, decryptSecret(p.signingSecretPartBEnc, SECRET_KEY), p.signingSecretPartBEnc, h.fake.url, PART_A, "submit_url"])
      assert.equal(all.includes(s), false, `response leaked ${s.slice(0, 10)}…`);
  } finally {
    await h.close();
  }
});

test("not configured: POST /pairings → 503 {ok:false,msg:'EFT is not configured'}", async () => {
  const h = await setup({ secretKeyHex: "" });
  try {
    const r = await h.call("POST", "/pairings", { pairingCode: "123456" });
    assert.equal(r.status, 503);
    assert.deepEqual(r.json, { ok: false, msg: "EFT is not configured" });
    const c = await h.call("POST", "/transactions", { operationId: "op-http-0002", kind: "PURCHASE", amountCents: 100 });
    assert.equal(c.status, 503);
  } finally {
    await h.close();
  }
});

test("T-9: POST /pairings with a wrong code → 400 verbatim [PAIR]; DELETE /pairings/:id active → 409, after unpair → 204 + lane cleared", async () => {
  const h = await setup();
  try {
    const bad = await h.call("POST", "/pairings", { pairingCode: "123457" });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json, {
      ok: false,
      msg: "Invalid pairing code — check the code on the terminal [PAIR]",
      result: { errorClass: "PAIR", errorCode: "invalid_pairing_code" },
    });

    const pid = (await h.call("POST", "/pairings", { pairingCode: "123456" })).json.result.id;
    assert.equal((await h.call("POST", `/pairings/${pid}/select`)).status, 200);
    const active = await h.call("DELETE", `/pairings/${pid}`);
    assert.equal(active.status, 409);
    assert.equal(active.json.msg, "Unpair this terminal before deleting it [PAIR]");
    assert.equal(active.json.result.errorCode, "PAIRING_ACTIVE");

    assert.equal((await h.call("POST", `/pairings/${pid}/unpair`)).status, 200);
    const res = await fetch(`${h.base}/pairings/${pid}`, { method: "DELETE" });
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
    assert.equal(h.store.terminals[0].eftPairingId, null);
    assert.deepEqual((await h.call("GET", "/pairings")).json.result, []);
    assert.equal((await h.call("DELETE", `/pairings/${pid}`)).status, 404);
    assert.equal((await h.call("DELETE", "/pairings/abc")).status, 400);
  } finally {
    await h.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { FAKE_SCI_PAIRING_CODE, startFakeSci } from "./fake-sci";

// T-9 (F-20): the fake's Pairing API accepts only 123456 unless anyCode / FAKE_SCI_ANY_CODE=1.

async function pair(url: string, code: string) {
  const res = await fetch(`${url}/v1/progress-pairing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairing_code: code }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

test("fake SCI pairing: 123456 → confirmation 456456; any other 6-digit code → 400 invalid_pairing_code", async () => {
  const fake = await startFakeSci({ port: 0, partA: "p", anyCode: false, log: () => undefined });
  try {
    assert.equal(FAKE_SCI_PAIRING_CODE, "123456");
    const ok = await pair(fake.url, "123456");
    assert.equal(ok.status, 200);
    assert.equal(ok.json.confirmation_code, "456456");
    for (const code of ["123457", "000000", "654321"]) {
      const bad = await pair(fake.url, code);
      assert.equal(bad.status, 400, code);
      assert.deepEqual(bad.json, { error: "invalid_pairing_code", message: "Invalid pairing code" });
    }
    const shape = await pair(fake.url, "12345");
    assert.equal(shape.status, 400);
  } finally {
    await fake.stop();
  }
});

test("fake SCI pairing: anyCode (or env FAKE_SCI_ANY_CODE=1) accepts any 6 digits, confirmation = last 3 twice", async () => {
  const fake = await startFakeSci({ port: 0, partA: "p", anyCode: true, log: () => undefined });
  try {
    const r = await pair(fake.url, "123457");
    assert.equal(r.status, 200);
    assert.equal(r.json.confirmation_code, "457457");
  } finally {
    await fake.stop();
  }
  const prev = process.env.FAKE_SCI_ANY_CODE;
  process.env.FAKE_SCI_ANY_CODE = "1";
  const viaEnv = await startFakeSci({ port: 0, partA: "p", log: () => undefined });
  try {
    assert.equal((await pair(viaEnv.url, "654321")).json.confirmation_code, "321321");
  } finally {
    if (prev === undefined) delete process.env.FAKE_SCI_ANY_CODE;
    else process.env.FAKE_SCI_ANY_CODE = prev;
    await viaEnv.stop();
  }
});
